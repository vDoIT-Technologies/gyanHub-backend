import OpenAI from "openai";
import { ENV } from "../configs/constant.js";

const openai = new OpenAI({
    apiKey: ENV.OPENAI_API_KEY
});

const topics = ["Light", "Force and Pressure", "Stars and the Solar System", "Pollution of Air and Water"];

const SYSTEM_PROMPT = `You are Sunita Gupta, a Class 8 Science teacher. You teach simple and clearly with examples.

Your style:
- Simple language for Class 8 students
- Use real-life examples from daily life in India
- Explain step by step, one concept at a time
- Each time explain a NEW concept, don't repeat
- Ask "Is this clear?", "Any doubts till now?" after each concept
- Be warm and encouraging

ONLY teach these topics: Light, Force and Pressure, Stars and the Solar System, Pollution of Air and Water

IMPORTANT: When student says "yes" or "clear", teach the NEXT concept, NOT the same one again!`;

let sessionTopic = null;
let conversationHistory = [];
let conceptCount = 0;
let sessionStarted = false;

const getSunitaResponse = async (userQuery, topic) => {
    const msg = userQuery.toLowerCase().trim();

    // Initialize session on first call
    if (!sessionStarted) {
        // Use provided topic or random topic
        sessionTopic = topic && topics.includes(topic) ? topic : topics[Math.floor(Math.random() * topics.length)];
        conversationHistory = [];
        conceptCount = 0;
        sessionStarted = true;

        conversationHistory.push({ role: "user", content: userQuery });

        // Start teaching the first concept directly
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 350,
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                {
                    role: "user",
                    content: `Start teaching about "${sessionTopic}". Teach the FIRST concept about this topic directly without greeting or introduction. Explain in 4-5 sentences with real Indian daily-life examples. Make it simple and clear. After explaining, ask "Is this clear?" or "Do you understand till now?"`
                }
            ],
            temperature: 0.7
        });

        const assistantMsg = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: assistantMsg });
        conceptCount++;

        return {
            success: true,
            response: assistantMsg,
            topic: sessionTopic,
            stage: "teaching",
            conceptCount: conceptCount,
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };
    }

    // Check if ready (Yes, Ok, Ready, etc) - to teach next concept
    const isReady = msg.includes("yes") || msg.includes("ok") || msg.includes("okay") || msg.includes("ready") || msg.includes("start") || msg.includes("begin") || msg.includes("yup") || msg.includes("sure") || msg.includes("clear") || msg.includes("got it") || msg.includes("understood");
    
    // Check if asking (What, How, Why, etc)
    const isQuestion = msg.includes("what") || msg.includes("how") || msg.includes("why") || msg.includes("tell") || msg.includes("explain") || msg.includes("does") || msg.includes("can you") || msg.includes("clarify");

    // Check if not understanding
    const isConfused = msg.includes("don't understand") || msg.includes("confused") || msg.includes("not clear") || msg.includes("explain again") || msg.includes("don't get it");

    // READY - Teach next concept
    if (isReady && !isQuestion && !isConfused) {
        conversationHistory.push({ role: "user", content: userQuery });
        conceptCount++;

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
                    content: `I am teaching about: "${sessionTopic}". The student understood the previous concept. Now teach concept ${conceptCount} about ${sessionTopic}. Explain this NEW concept in 4-5 sentences with real Indian daily-life examples. Make it simple and clear. After explaining, ask "Is this clear?" or "Do you understand till now?"`
                }
            ],
            temperature: 0.7
        });

        const assistantMsg = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: assistantMsg });

        return {
            success: true,
            response: assistantMsg,
            topic: sessionTopic,
            stage: "teaching",
            conceptCount: conceptCount,
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };
    }

    // QUESTION - Answer and continue
    if (isQuestion) {
        conversationHistory.push({ role: "user", content: userQuery });

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
                    content: `I am teaching about: "${sessionTopic}". Student asked: "${userQuery}". Answer their question in 3-4 sentences with simple language and real Indian examples. Then ask "Do you understand this?" or "Any doubts still?"`
                }
            ],
            temperature: 0.7
        });

        const assistantMsg = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: assistantMsg });

        return {
            success: true,
            response: assistantMsg,
            topic: sessionTopic,
            stage: "interaction",
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };
    }

    // CONFUSED - Re-explain with different examples
    if (isConfused) {
        conversationHistory.push({ role: "user", content: userQuery });

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
                    content: `I am teaching about: "${sessionTopic}". Student says: "${userQuery}". They didn't understand the previous concept. Explain the same concept again with DIFFERENT and simpler examples from Indian daily life. Use analogies and simple comparisons. Make it very clear and easy to understand. After explaining, ask "Is it clear now?"`
                }
            ],
            temperature: 0.7
        });

        const assistantMsg = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: assistantMsg });

        return {
            success: true,
            response: assistantMsg,
            topic: sessionTopic,
            stage: "clarifying",
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        };
    }

    // ANY OTHER MESSAGE - Continue teaching
    conversationHistory.push({ role: "user", content: userQuery });

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
                content: `Student said: "${userQuery}". I am teaching about ${sessionTopic}. Respond warmly and ask if they understand the current concept or if they have any doubts. Use simple language and examples.`
            }
        ],
        temperature: 0.7
    });

    const assistantMsg = response.choices[0].message.content;
    conversationHistory.push({ role: "assistant", content: assistantMsg });

    return {
        success: true,
        response: assistantMsg,
        topic: sessionTopic,
        stage: "interaction",
        brainId: "MwUdldmtb1Qt7mDEbKM3"
    };
}

const sunitaChat = async (c) => {
    try {
        const body = await c.req.json();
        const { userQuery, topic } = body;

        if (!userQuery) {
            return c.json({
                success: false,
                error: "userQuery is required"
            }, 400);
        }

        const result = await getSunitaResponse(userQuery, topic);
        return c.json(result, 200);

    } catch (error) {
        console.error('Error:', error.message);
        return c.json({
            success: false,
            error: error.message,
            brainId: "MwUdldmtb1Qt7mDEbKM3"
        }, 500);
    }
};

export { sunitaChat, getSunitaResponse };