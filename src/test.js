import { scienceTeacherChat } from './services/OpenAi.service.js';

async function test() {
    console.log("🎓 Testing Science Teacher Sunita Gupta\n");
    
    const question = "What is photosynthesis?";
    console.log(`Student: ${question}\n`);
    
    const response = await scienceTeacherChat(question);
    
    if (response.success) {
        console.log(`Teacher ${response.teacherName}:\n${response.data}`);
    } else {
        console.log(`Error: ${response.error}`);
    }
}

test();