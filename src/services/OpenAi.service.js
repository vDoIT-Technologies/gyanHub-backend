import OpenAI from "openai";
import { ENV } from "../configs/constant.js";

const openai = new OpenAI({
    apiKey: ENV.OPENAI_API_KEY
});

const topics = ["Light"];

const SYSTEM_PROMPT = `You are Sunita Gupta, a Class 8 Science teacher. You teach simple and clearly with examples.

Your style:
- Simple language for Class 8 students
- Use real-life examples from daily life in India
- Explain step by step, one concept at a time
- Each time explain a NEW concept, don't repeat
- Ask "Is this clear?", "Any doubts till now?" after each concept
- Be warm and encouraging

ONLY teach these topics: Light;

IMPORTANT: When student says "yes" or "clear", teach the NEXT concept, NOT the same one again!`;

let sessionTopic = null;
let conversationHistory = [];
let conceptCount = 0;

const scienceTeacherChat = async (userMessage) => {
    try {
        const msg = userMessage.toLowerCase().trim();

        // Check if greeting (Hi, Hello, etc)
        const isGreeting = msg.includes("hi") || msg.includes("hello") || msg.includes("hey") || msg.includes("good morning") || msg.includes("good afternoon") || msg.includes("namaste");
        
        // Check if ready (Yes, Ok, Ready, etc)
        const isReady = msg.includes("yes") || msg.includes("ok") || msg.includes("ready") || msg.includes("start") || msg.includes("begin") || msg.includes("yup") || msg.includes("sure") || msg.includes("clear");
        
        // Check if asking (What, How, Why, etc)
        const isQuestion = msg.includes("what") || msg.includes("how") || msg.includes("why") || msg.includes("tell") || msg.includes("explain") || msg.includes("does");

        // GREETING - Introduce topic
        if (isGreeting) {
            sessionTopic = topics[Math.floor(Math.random() * topics.length)];
            conversationHistory = [];
            conceptCount = 0;

            conversationHistory.push({ role: "user", content: userMessage });

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT
                    },
                    {
                        role: "user",
                        content: `Student greeted me: "${userMessage}". Greet them warmly and say: "Hello! I'm Sunita Gupta, your Science teacher. Today we will learn about ${sessionTopic}. This is a very important topic! Are you ready to start learning?"`
                    }
                ],
                temperature: 0.7
            });

            const assistantMsg = response.choices[0].message.content;
            conversationHistory.push({ role: "assistant", content: assistantMsg });

            return {
                success: true,
                data: assistantMsg,
                topic: sessionTopic,
                stage: "greeting",
                brainId: "MwUdldmtb1Qt7mDEbKM3"
            };
        }

        // READY - Start teaching or continue to next concept
        if (isReady && sessionTopic) {
            conceptCount++;
            conversationHistory.push({ role: "user", content: userMessage });

            let conceptNumber = conceptCount;
            let promptContent = `I am teaching about: "${sessionTopic}". 
The student understood concept ${conceptCount - 1}.
Now teach concept ${conceptNumber} about ${sessionTopic}.
Explain this NEW concept in 4-5 sentences with real Indian daily-life examples.
Make it simple and clear.
After explaining, ask "Is this clear?" or "Do you understand till now?"`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 350,
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT
                    },
                    ...conversationHistory.slice(-6),
                    {
                        role: "user",
                        content: promptContent
                    }
                ],
                temperature: 0.7
            });

            const assistantMsg = response.choices[0].message.content;
            conversationHistory.push({ role: "assistant", content: assistantMsg });

            return {
                success: true,
                data: assistantMsg,
                topic: sessionTopic,
                stage: "teaching",
                conceptCount: conceptCount,
                brainId: "MwUdldmtb1Qt7mDEbKM3"
            };
        }

        // QUESTION - Answer and continue teaching
        if (isQuestion && sessionTopic) {
            conversationHistory.push({ role: "user", content: userMessage });

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 300,
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT
                    },
                    ...conversationHistory.slice(-6),
                    {
                        role: "user",
                        content: `I am teaching about: "${sessionTopic}". Student asked: "${userMessage}". Answer their question in 3-4 sentences with simple language and real Indian examples. Then ask "Do you understand this?" or "Any doubts still?" and continue with the next concept if they are ready.`
                    }
                ],
                temperature: 0.7
            });

            const assistantMsg = response.choices[0].message.content;
            conversationHistory.push({ role: "assistant", content: assistantMsg });

            return {
                success: true,
                data: assistantMsg,
                topic: sessionTopic,
                stage: "interaction",
                brainId: "MwUdldmtb1Qt7mDEbKM3"
            };
        }

        // ANY OTHER MESSAGE - Continue teaching
        conversationHistory.push({ role: "user", content: userMessage });

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 300,
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                ...conversationHistory.slice(-6),
                {
                    role: "user",
                    content: `Student said: "${userMessage}". I am teaching about ${sessionTopic || 'Science'}. Respond warmly and continue teaching the next concept or ask "Any doubts till now?" Use simple language and examples.`
                }
            ],
            temperature: 0.7
        });

        const assistantMsg = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: assistantMsg });

        return {
            success: true,
            data: assistantMsg,
            topic: sessionTopic,
            stage: "interaction",
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };

    } catch (error) {
        console.error('Error:', error.message);
        return {
            success: false,
            data: 'Error. Please try again.',
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };
    }
};



export { scienceTeacherChat };