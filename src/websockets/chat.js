import { ChatService } from '../services/ChatService.js';
import ElevenLabsStreamer from '../services/ElevenLabsService.js';
import { ENV } from '../configs/constant.js';
// import {  scienceTeacherChat } from '../services/OpenAi.service.js';
import WebSocket from 'ws';
// import { natashaTeacherChat } from '../services/NatashaService.js';
import { sunitaChat, getSunitaResponse } from '../controllers/llm.controller.js';

const chatService = new ChatService();

export const WebsocketsChat = (wss) => {
    wss.on('connection', (ws) => {
        if (ENV.NODE_ENV === 'development') {
            console.log('New connection');
        }

        ws.on('message', async (message) => {
            let data = null;

            try {
                data = JSON.parse(message);
            } catch (e) {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: 'Invalid JSON format'
                    })
                );
                return;
            }

            if (!data.sessionId) {
                return ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: 'Session ID is missing'
                    })
                );
            }

            if (data.type === 'query_wa') {
                try {
                    if (data.personalityId === ENV.BEN_SNET_ID) {
                        const wsClient = new WebSocket(ENV.WEBSOCKET_URL_BEN_SNET);

                        wsClient.on('open', () => {
                            const payload = {
                                client: 'web',
                                username: 'test_username',
                                request_type: 'text',
                                response_type: 'text',
                                text: data.message
                            };
                            wsClient.send(JSON.stringify(payload));
                        });

                        wsClient.on('message', async (response) => {
                            try {
                                const parsedResponse = JSON.parse(response);
                                const messageAi = parsedResponse.response;
                                console.log("messageAi", messageAi);

                                ws.send(
                                    JSON.stringify({
                                        type: 'response',
                                        sessionId: data.sessionId,
                                        message: parsedResponse
                                    })
                                );

                                await chatService.saveBenSnetChat(
                                    data.sessionId,
                                    data.userId,
                                    data.message,
                                    messageAi,
                                    data.personalityId
                                );

                                // Title Generation Logic
                                try {
                                    if (!data.isTitleEdit) {
                                        const titleGeneration = await chatService.chatTitleGeneration(
                                            data.message,
                                            data.sessionId
                                        );
                                    }
                                } catch (error) {
                                    console.error(`Error generating title for session ${data.sessionId}:`, error);
                                }
                            } catch (error) {
                                ws.send(
                                    JSON.stringify({
                                        type: 'error',
                                        sessionId: data.sessionId,
                                        message: `Error parsing response: ${error.message}`
                                    })
                                );
                            }
                        });

                        wsClient.on('error', (err) => {
                            ws.send(
                                JSON.stringify({
                                    type: 'error',
                                    sessionId: data.sessionId,
                                    message: `WebSocket client error: ${err.message}`
                                })
                            );
                        });

                        return;
                    }

                    // const response = await chatService.chat(
                    //     data.sessionId,
                    //     data.message,
                    //     data.userId,
                    //     data.personalityId,
                    //     data.wordLimit,
                    //     data.modelName
                    // );
                    const response = await getSunitaResponse(data.message)
                    console.log(response, 120)
                    const streamer = new ElevenLabsStreamer(ENV.ELEVENLABS_API_KEY, "MwUdldmtb1Qt7mDEbKM3");
                    const streamResult = await streamer.streamTextAndAudio(response.response);

                    if (streamResult) {
                        const { audioBuffer, characters, characterStartTimesSeconds } = streamResult;
                        const base64Audio = audioBuffer.toString('base64');

                        ws.send(
                            JSON.stringify({
                                type: 'audio',
                                sessionId: data.sessionId,
                                message: base64Audio
                            })
                        );

                        characters.forEach((char, index) => {
                            const delay = characterStartTimesSeconds[index] * 1000;
                            setTimeout(() => {
                                ws.send(
                                    JSON.stringify({
                                        type: 'character',
                                        sessionId: data.sessionId,
                                        message: char
                                    })
                                );
                            }, delay);
                        });

                        const totalDuration = characterStartTimesSeconds[characterStartTimesSeconds.length - 1] * 1000;
                        setTimeout(() => {
                            ws.send(
                                JSON.stringify({
                                    type: 'end',
                                    sessionId: data.sessionId,
                                    message: ''
                                })
                            );
                        }, totalDuration + 100);

                        // Title Generation Logic
                        try {
                            if (!data.isTitleEdit) {
                                const titleGeneration = await chatService.chatTitleGeneration(
                                    data.message,
                                    data.sessionId
                                );
                            }
                        } catch (error) {
                            console.error(`Error generating title for session ${data.sessionId}:`, error);
                        }

                        // referenceChatLogic
                        // setTimeout(async () => {
                        //     try {
                        //         const referenceChatResult = await chatService.referencechat(response.data, data.userId);
                        //         ws.send(
                        //             JSON.stringify({
                        //                 type: 'reference_response',
                        //                 sessionId: data.sessionId,
                        //                 message: referenceChatResult || 'No reference data available'
                        //             })
                        //         );
                        //     } catch (error) {
                        //         ws.send(
                        //             JSON.stringify({
                        //                 type: 'error',
                        //                 sessionId: data.sessionId,
                        //                 message: `Failed to fetch reference chat: ${error.message}`
                        //             })
                        //         );
                        //     }
                        // }, totalDuration + 100);
                    }
                } catch (error) {
                    ws.send(
                        JSON.stringify({
                            type: 'error',
                            message: `Failed to process query: ${error.message}`,
                            sessionId: data.sessionId
                        })
                    );
                }
            } else {
                ws.send(`You sent => ${message}`);
            }
        });

        ws.on('close', () => {
            console.log('Connection closed');
           
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });
};
