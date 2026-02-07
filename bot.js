const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. الإعدادات الأساسية (استخدم Variables في Railway أفضل)
// ==========================================
const token = '8273814930:AAEdxVzhYjnNZqdJKvpGJC9k1bVf2hcGUV4'; 
const GITHUB_TOKEN = "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"; 
const GITHUB_REPO_OWNER = "peacemaker3050-ux";      
const GITHUB_REPO_NAME = "2ndMec";             

const AUTHORIZED_USERS = [5605597142]; // الملاك المسموح لهم

// مفاتيح JSONBin
const JSONBIN_BIN_ID = "696e77bfae596e708fe71e9d";
const JSONBIN_ACCESS_KEY = "$2a$10$TunKuA35QdJp478eIMXxRunQfqgmhDY3YAxBXUXuV/JrgIFhU0Lf2";

const bot = new TelegramBot(token, { polling: true });
const userStates = {}; 

// ==========================================
// 2. دالة الرفع إلى GitHub (نظام Contents API - Base64)
// ==========================================
async function uploadToGithub(filePath, fileName) {
    try {
        const content = fs.readFileSync(filePath, { encoding: 'base64' });
        // تنظيف اسم الملف من المسافات
        const cleanFileName = fileName.replace(/\s+/g, '_');
        const uploadPath = `uploads/${Date.now()}_${cleanFileName}`;

        const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${uploadPath}`;

        const response = await axios.put(url, {
            message: `Upload file: ${cleanFileName}`,
            content: content
        }, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        // الرابط المباشر للملف (Raw) اللي هيفتح أوفلاين في موقعك
        return `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main/${uploadPath}`;

    } catch (error) {
        console.error("GitHub API Error:", error.response ? error.response.data : error.message);
        throw new Error("فشل الرفع إلى جيت هوب، تأكد من التوكن وصلاحيات المستودع.");
    }
}

// ==========================================
// 3. دوال قاعدة البيانات (JSONBin)
// ==========================================
async function getDatabase() {
    const resp = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_ACCESS_KEY, 'X-Bin-Meta': 'false' }
    });
    return resp.data;
}

async function saveDatabase(data) {
    await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, data, {
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_ACCESS_KEY }
    });
}

// ==========================================
// 4. معالجة الرسائل والملفات
// ==========================================

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    if (!AUTHORIZED_USERS.includes(chatId)) return;

    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name;

    bot.sendMessage(chatId, `⏳ جاري تحميل الملف من تليجرام...`);

    try {
        const fileLink = await bot.getFileLink(fileId);
        const tempPath = path.join('/tmp', fileName); // مسار مؤقت لـ Railway

        // تحميل الملف محلياً
        const resp = await axios({ url: fileLink, responseType: 'stream' });
        const writer = fs.createWriteStream(tempPath);
        resp.data.pipe(writer);

        writer.on('finish', async () => {
            userStates[chatId] = { step: 'select_subject', file: { path: tempPath, name: fileName } };
            
            const db = await getDatabase();
            const subjects = Object.keys(db.database);
            const keyboard = subjects.map(sub => [{ text: sub, callback_data: `sub_${sub}` }]);

            bot.sendMessage(chatId, "✅ تم التحميل. اختر المادة:", {
                reply_markup: { inline_keyboard: keyboard }
            });
        });
    } catch (err) {
        bot.sendMessage(chatId, "❌ فشل في معالجة الملف.");
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates[chatId];

    if (!state) return;

    if (data.startsWith('sub_')) {
        state.subject = data.replace('sub_', '');
        const db = await getDatabase();
        const doctors = db.database[state.subject].doctors || [];
        const keyboard = doctors.map(doc => [{ text: doc, callback_data: `doc_${doc}` }]);
        
        state.step = 'select_doctor';
        bot.editMessageText("اختر الدكتور:", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
    } 
    else if (data.startsWith('doc_')) {
        state.doctor = data.replace('doc_', '');
        const db = await getDatabase();
        const sections = db.database[state.subject][state.doctor].sections || [];
        const keyboard = sections.map(sec => [{ text: sec, callback_data: `sec_${sec}` }]);

        state.step = 'select_section';
        bot.editMessageText("اختر القسم:", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
    }
    else if (data.startsWith('sec_')) {
        const section = data.replace('sec_', '');
        bot.editMessageText("🚀 جاري الرفع إلى GitHub وتحديث الموقع...", { chat_id: chatId, message_id: query.message.message_id });

        try {
            // 1. الرفع لجيت هوب
            const githubUrl = await uploadToGithub(state.file.path, state.file.name);
            
            // 2. التحديث في JSONBin
            const db = await getDatabase();
            db.database[state.subject][state.doctor][section].push({
                name: state.file.name,
                link: githubUrl
            });
            
            // إضافة إشعار تلقائي للموقع
            db.recentUpdates = db.recentUpdates || [];
            db.recentUpdates.unshift({
                subject: state.subject,
                doctor: state.doctor,
                timestamp: Date.now()
            });

            await saveDatabase(db);

            bot.sendMessage(chatId, `✅ تم الرفع بنجاح!\n🔗 الرابط: ${githubUrl}`);
            fs.unlinkSync(state.file.path); // حذف الملف المؤقت
            delete userStates[chatId];

        } catch (err) {
            bot.sendMessage(chatId, `❌ خطأ: ${err.message}`);
        }
    }
});