import { Buffer } from 'buffer';
class ElevenLabsStreamer {
    /**
     * Creates an instance of ElevenLabsStreamer.
     * @param {string} apiKey - API key for Eleven Labs authentication.
     * @param {string} brainId - Default voice ID for the service.
     */
    constructor(apiKey, brainId = 'MwUdldmtb1Qt7mDEbKM3') {
        this.apiKey = apiKey;
        this.brainId = brainId;
        this.url = `https://api.elevenlabs.io/v1/text-to-speech/${this.brainId}/stream/with-timestamps`; // time stamp api is used to sync text with audio
        this.headers = {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
        };
    }

    /**
     * Streams text-to-speech audio and alignment data.
     * @param {string} text - Text to convert to speech.
     * @param {string} modelId- Model ID to use for the speech synthesis.
     * @param {number} stability - Stability value for speech synthesis.
     * @param {number} similarityBoost - Similarity boost value for speech synthesis.
     * @returns {Promise<Object|null>} An object containing audio buffer, characters, and their start times, or null on failure.
     */
    async streamTextAndAudio(
        text,
        modelId = 'eleven_turbo_v2_5', // do no change this model . Its the best performing mdel at the moment .
        stability = 0.6, // do not change this value . Its the best performing value at the moment .
        similarityBoost = 0.75 // do not change this value . Its the best performing value at the moment .
    ) {
        const data = {
            text: text,
            model_id: modelId,
            voice_settings: {
                stability: stability,
                similarity_boost: similarityBoost
            }
        };

        try {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                console.error(`Error encountered, status: ${response.status}, content: ${await response.text()}`);
                return null;
            }

            if (!response.body) {
                return null;
            }

            const reader = response.body.getReader();
            let audioBuffer = Buffer.alloc(0);
            let characters = [];
            let characterStartTimesSeconds = [];
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += new TextDecoder().decode(value);

                let startIndex = 0;
                while (true) {
                    const endIndex = buffer.indexOf('\n', startIndex);
                    if (endIndex === -1) break;

                    const line = buffer.slice(startIndex, endIndex).trim();
                    startIndex = endIndex + 1;

                    if (line) {
                        try {
                            const responseDict = JSON.parse(line);
                            if (responseDict.audio_base64) {
                                const audioChunk = Buffer.from(responseDict.audio_base64, 'base64');
                                audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
                            }

                            if (responseDict.alignment) {
                                characters = characters.concat(responseDict.alignment.characters);
                                characterStartTimesSeconds = characterStartTimesSeconds.concat(
                                    responseDict.alignment.character_start_times_seconds
                                );
                            }
                        } catch (error) {
                            console.warn('Error parsing JSON:', error);
                        }
                    }
                }

                buffer = buffer.slice(startIndex);
            }

            return {
                audioBuffer,
                characters,
                characterStartTimesSeconds
            };
        } catch (error) {
            return null;
        }
    }
}

export default ElevenLabsStreamer;
