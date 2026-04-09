import { Hono } from 'hono';
import adminVerifyAuth from '../middleware/adminVerifyAuth.js';
import {
    checkProfile,
    createPersonality,
    dashboard,
    deleteFile,
    deletePersonality,
    editPersonality,
    getAdminProfile,
    getAllPersonalities,
    getAllUsers,
    getSpecificPersonality,
    getUserSpecificDetails,
    login,
    logOut,
    refreshToAccessToken,
    updateProfile,
    validateElevenLabsVoiceId,
    uploadImageToLibrary,
    getImageLibrary
} from '../controllers/admin.controller.js';
import {
    createAvatarTeacher,
    deleteAvatarTeacher,
    getAllAvatarTeachers,
    getAvatarTeacherById,
    updateAvatarTeacher
} from '../controllers/avatarTeacher.controller.js';

const app = new Hono();

app.post('/login', login);

app.get('/dashboard', adminVerifyAuth, dashboard);

app.get('/fetch-users', adminVerifyAuth, getAllUsers);

app.get('/fetch-user/:userId', adminVerifyAuth, getUserSpecificDetails);

app.get('/getProfile', adminVerifyAuth, getAdminProfile);

app.post('/logout', adminVerifyAuth, logOut);

app.get('/refresh-token', refreshToAccessToken);

app.post('/check-profile', adminVerifyAuth, checkProfile);

app.put('/update-profile', adminVerifyAuth, updateProfile);

app.post('/createPersonality', adminVerifyAuth, createPersonality);

app.get('/personality/:personalityId', adminVerifyAuth, getSpecificPersonality);

app.get('/fetch-allPersonalities', adminVerifyAuth, getAllPersonalities);

app.put('/edit/:personalityId', adminVerifyAuth, editPersonality);

app.delete('/personality/file', adminVerifyAuth, deleteFile);

app.delete('/delete/:personalityId', adminVerifyAuth, deletePersonality);

app.get('/validate-voice/:brainId', adminVerifyAuth, validateElevenLabsVoiceId);

// ── Avatar Teacher management ──────────────────────────────────────────────
app.post('/avatar-teacher', adminVerifyAuth, createAvatarTeacher);
app.get('/avatar-teacher', adminVerifyAuth, getAllAvatarTeachers);
app.get('/avatar-teacher/:id', adminVerifyAuth, getAvatarTeacherById);
app.put('/avatar-teacher/:id', adminVerifyAuth, updateAvatarTeacher);
app.delete('/avatar-teacher/:id', adminVerifyAuth, deleteAvatarTeacher);

// ── Image Library Management ──────────────────────────────────────────────
app.get('/image-library', adminVerifyAuth, getImageLibrary);
app.post('/image-library', adminVerifyAuth, uploadImageToLibrary);

export default app;
