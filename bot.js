const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ==========================================
// 1. بيانات البوت والمالك (جاهزة ومحدّثة)
// ==========================================

// توكن البوت الخاص بك (@MecWebBot)
const token = '8273814930:AAEdxVzhYjnNZqdJKvpGJC9k1bVf2hcGUV4'; 

// رقم الـ ID الخاص بك (للسماح لك فقط بالاستخدام)
const OWNER_ID = 5605597142; 

// مفاتيح قاعدة البيانات (JSONBin) - مأخوذة من كود موقعك
const JSONBIN_BIN_ID = "696e77bfae596e708fe71e9d";
const JSONBIN_ACCESS_KEY = "$2a$10$TunKuA35QdJp478eIMXxRunQfqgmhDY3YAxBXUXuV/JrgIFhU0Lf2";

const bot = new TelegramBot(token, { polling: true });

// لتخزين حالة المحادثة
const userStates = {}; 

// ==========================================
// 2. دوال الاتصال بقاعدة البيانات
// ==========================================

async function getDatabase() {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_ACCESS_KEY, 'X-Bin-Meta': 'false' }
        });
        return response.data;
    } catch (error) {
        console.error("خطأ في جلب البيانات:", error.message);
        return null;
    }
}

async function saveDatabase(data) {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, data, {
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_ACCESS_KEY }
        });
        console.log("تم تحديث قاعدة البيانات بنجاح!");
    } catch (error) {
        console.error("خطأ في حفظ البيانات:", error.message);
        throw error;
    }
}

async function getTelegramFileLink(fileId) {
    try {
        const file = await bot.getFile(fileId);
        return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    } catch (error) {
        console.error("خطأ في رابط الملف:", error);
        return null;
    }
}

// ==========================================
// 3. استقبال الرسائل والملفات
// ==========================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) {
        bot.sendMessage(chatId, "⛔ عذراً، هذا البوت للإدارة فقط.");
        return;
    }
    bot.sendMessage(chatId, "👋 أهلاً بك في نظام MecWeb.\nأرسل أي ملف وسأقوم بإضافته للموقع تلقائياً.");
});

bot.on('document', async (msg) => handleFile(msg));
bot.on('photo', async (msg) => {
    const photo = msg.photo[msg.photo.length - 1];
    handleFile({ ...msg, document: photo, caption: msg.caption || "صورة" });
});

async function handleFile(msg) {
    const chatId = msg.chat.id;
    if (chatId !== OWNER_ID) return;

    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name || "ملف_" + Date.now();

    userStates[chatId] = {
        step: 'select_subject',
        file: { id: fileId, name: fileName }
    };

    const data = await getDatabase();
    if (!data || !data.database) {
        bot.sendMessage(chatId, "❌ حدث خطأ في الاتصال بقاعدة البيانات.");
        return;
    }

    const subjects = Object.keys(data.database);
    const keyboard = subjects.map(sub => [{ text: sub, callback_data: `sub_${sub}` }]);

    bot.sendMessage(chatId, `📂 الملف: *${fileName}*\n\nاختر المادة:`, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}

// ==========================================
// 4. التعامل مع اختيار الأزرار
// ==========================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates[chatId];

    if (!state) {
        bot.answerCallbackQuery(query.id, { text: "انتهت الجلسة. أرسل الملف مرة أخرى.", show_alert: true });
        return;
    }

    // اختيار المادة
    if (state.step === 'select_subject' && data.startsWith('sub_')) {
        const subjectName = data.replace('sub_', '');
        state.subject = subjectName;
        state.step = 'select_doctor';

        const db = await getDatabase();
        if(!db.database[subjectName]) {
             bot.answerCallbackQuery(query.id, { text: "المادة غير موجودة!", show_alert: true });
             return;
        }

        const doctors = db.database[subjectName].doctors || [];
        const keyboard = doctors.map(doc => [{ text: doc, callback_data: `doc_${doc}` }]);

        bot.editMessageText(`المادة: *${subjectName}*\n\nاختر الدكتور:`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // اختيار الدكتور
    else if (state.step === 'select_doctor' && data.startsWith('doc_')) {
        const doctorName = data.replace('doc_', '');
        state.doctor = doctorName;
        state.step = 'select_section';

        const db = await getDatabase();
        const sections = db.database[state.subject][doctorName].sections || [];
        const keyboard = sections.map(sec => [{ text: sec, callback_data: `sec_${sec}` }]);

        bot.editMessageText(`الدكتور: *${doctorName}*\n\nاختر القسم:`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        });
    }

    // اختيار القسم والرفع
    else if (state.step === 'select_section' && data.startsWith('sec_')) {
        const sectionName = data.replace('sec_', '');
        bot.answerCallbackQuery(query.id, { text: "جاري الرفع... ⏳" });

        const fileLink = await getTelegramFileLink(state.file.id);

        if (!fileLink) {
            bot.sendMessage(chatId, "❌ فشل الحصول على رابط الملف.");
            delete userStates[chatId];
            return;
        }

        const db = await getDatabase();
        
        if (db.database[state.subject] && 
            db.database[state.subject][state.doctor] && 
            db.database[state.subject][state.doctor][sectionName]) {
            
            db.database[state.subject][state.doctor][sectionName].push({
                name: state.file.name,
                link: fileLink
            });

            try {
                await saveDatabase(db);
                
                bot.editMessageText(`✅ *تم الرفع بنجاح!*\n\n📂 ${state.subject}\n👨‍🏫 ${state.doctor}\n📁 ${sectionName}\n\n✨ الملف ظاهر الآن في الموقع.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown'
                });
                
                delete userStates[chatId];

            } catch (err) {
                bot.sendMessage(chatId, "❌ فشل الحفظ في السيرفر.");
                console.error(err);
            }
        }
    }
});