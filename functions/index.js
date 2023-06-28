const { Configuration, OpenAIApi } = require("openai");
const Busboy = require('busboy');
const { Writable } = require('stream');
const { promisify } = require('util');
const pipeline = promisify(require('stream').pipeline);
const admin = require('firebase-admin');
const functions = require('firebase-functions');

admin.initializeApp();

exports.getTranscription= functions.https.onRequest(async (req, res) => {
    try {
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const openai = new OpenAIApi(configuration);

        if (req.method === 'POST') {
            const busboy = new Busboy({ headers: req.headers });

            busboy.on('file', async function(fieldname, file, filename, encoding, mimetype) {
                console.log(`Processing file ${filename}`);
                const buffers = [];
                for await (const chunk of file) {
                    buffers.push(chunk);
                }
                const audioData = Buffer.concat(buffers);

                // Create a buffer stream
                const stream = require('stream');
                const bufferStream = new stream.PassThrough();
                bufferStream.end(audioData);

                const resp = await openai.createTranscription(
                    bufferStream,
                    "whisper-1"
                );

                res.send(resp.data);
            });

            busboy.on('finish', function() {
                console.log('Done parsing form!');
            });

            busboy.end(req.rawBody);
        } else {
            // Return a "method not allowed" error
            res.status(405).end();
        }
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});


exports.getTranslation= functions.https.onRequest(async (req, res) => {
    try {
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const openai = new OpenAIApi(configuration);

        // Get the context messages from the database
        const db = admin.firestore();
        const translationsRef = db.collection('translations');
        const firstLanguageSnapshot = await translationsRef.where('iso-code.value', '==', req.body.firstLanguage).limit(1).get();
        const secondLanguageSnapshot = await translationsRef.where('iso-code.value', '==', req.body.secondLanguage).limit(1).get();

        if (firstLanguageSnapshot.empty || secondLanguageSnapshot.empty) {
            const errorMessage= firstLanguageSnapshot.empty ? req.body.firstLanguage + 'not supported' : secondLanguageSnapshot.empty ? req.body.secondLanguage + 'not supported' : 'Error: languages not supported';
            res.status(500).send('Error: ' +  errorMessage);
            return;
        }

        const firstLanguageDoc = firstLanguageSnapshot.docs[0].data();
        const secondLanguageDoc = secondLanguageSnapshot.docs[0].data();

        const completion = await openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [{"role": "system", "content": 'You are in translator mode. You respond with a translation from ${firstLanguageDoc.name} to ${secondLanguageDoc.name}'},
                     {"role": "user", "content": firstLanguageDoc["sample-phrases"][0]},
                     {"role": "assistant", "content": secondLanguageDoc["sample-phrases"][0]},
                     //{"role": "user", "content": firstLanguageDoc["sample-phrases"][1]},
                     //{"role": "assistant", "content": secondLanguageDoc["sample-phrases"][1]},
                     {"role": "user", "content": req.body.transcription,
                     ],
        });
        console.log(completion.data.choices[0].message);
        res.send(completion.data);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
)};

// Import and initialize the client
const textToSpeech =  require('@google-cloud/text-to-speech');
const client = new textToSpeech.TextToSpeechClient();

exports.synthesizeSpeech = functions.https.onRequest(async (req, res) => {
    // Get the text to be synthesized
    const text = req.body.translation;
    // Get the language of the text to be synthesized
    const lang = req.body.language
    // Create a request object to be sent to Google's API
    const request = {
        input: {text: text},
        // Select the language and voidce gender
        voice: {languageCode: lang, ssmlGender: 'NEUTRAL'},
        // Select the type of audio encoding
        audioConfig: {audioEncoding: 'MP3'},
    };

    // Perform the text-to-speech API request
    const [response] = await client.synthesizeSpeech(request);

    // Return the base64 audio content in the response
    res.status(200).send({ audioContent: response.audioContent });
});
