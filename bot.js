const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs'); // تم إضافة fs للتعامل مع الملفات
const FormData = require('form-data'); // تأكد من تثبيت هذه المكتبة: npm install form-data

// ==========================================
// 1. بيانات البوت وقائمة المستخدمين المسموح لهم
// ==========================================

// توكن البوت الخاص بك (@MecWebBot)
const token = '8273814930:AAEdxVzhYjnNZqdJKvpGJC9k1bVf2hcGUV4'; 

// ==========================================
// ⭐ قائمة الأشخاص المسموح لهم (ضع أرقام الـ ID هنا)
// ==========================================
const AUTHORIZED_USERS = [
    5605597142, // أنت (المالك)
    // 123456789, // أضف رقم الشخص الثاني هنا
    // 987654321, // أضف رقم الشخص الثالث هنا
];

// مفاتيح قاعدة البيانات (JSONBin)
const JSONBIN_BIN_ID = "696e77bfae596e708fe71e9d";
const JSONBIN_ACCESS_KEY = "$2a$10$TunKuA35QdJp478eIMXxRunQfqgmhDY3YAxBXUXuV/JrgIFhU0Lf2";

// ==========================================
// إعدادات GitHub (بياناتك الخاصة)
// ==========================================
const GITHUB_TOKEN = "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"; 
const GITHUB_REPO_OWNER = "peacemaker3050-ux";     
const GITHUB_REPO_NAME = "2ndMec";             

const bot = new TelegramBot(token, { polling: true });

// لتخزين حالة المحادثة
const userStates = {}; 

// ==========================================
// دالة رفع الملف على GitHub Releases
// ==========================================
async function uploadToGithubRelease(filePath, fileName) {
    try {
        const owner = GITHUB_REPO_OWNER;
        const repo = GITHUB_REPO_NAME;
        const token = GITHUB_TOKEN;

        // 1. إعداد اسم الـ Tag والـ Release
        const tag = `v_${fileName.replace(/\./g, '_')}_${Date.now()}`;
        const releaseName = `Upload: ${fileName}`;

        // 2. إنشاء أو الحصول على Release
        const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
        
        let releaseId;
        try {
            const createResp = await axios.post(releaseUrl, {
                tag_name: tag,
                name: releaseName,
                body: `Uploaded via UniBot: ${fileName}`,
                draft: false,
                prerelease: false
            }, { headers: { 'Authorization': `token ${token}` } });
            releaseId = createResp.data.id;
        } catch (error) {
            // إذا فشل لأن الـ Tag موجود، نحاول الحصول على آخر Release موجود
            try {
                const listResp = await axios.get(releaseUrl, { headers: { 'Authorization': `token ${token}` } });
                if (listResp.data && listResp.data.length > 0) {
                    releaseId = listResp.data[0].id;
                } else {
                    throw new Error("Could not create or find a release.");
                }
            } catch (listErr) {
                 throw new Error("Critical error accessing GitHub releases.");
            }
        }

        // 3. الحصول على رابط الرفع الخاص (Upload URL)
        const uploadUrlResp = await axios.get(`${releaseUrl}/${releaseId}`, { headers: { 'Authorization': `token ${token}` } });
        const uploadUrl = uploadUrlResp.data.upload_url;

        // 4. رفع الملف
        const fileStream = fs.createReadStream(filePath);
        const formData = new FormData();
        formData.append('file', fileStream);

        const uploadResp = await axios.post(uploadUrl, formData, {
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            headers: {
                ...formData.getHeaders(),
                'Authorization': `token ${token}`
            }
        });

        if (uploadResp.status === 201 || uploadResp.status === 200) {
            // 5. تكوين الرابط العام للتحميل
            const publicLink = `https://github.com/${owner}/${repo}/releases/download/${tag}/${fileName}`;
            return publicLink;
        } else {
            throw new Error(`Upload failed with status ${uploadResp.status}`);
        }

    } catch (error) {
        console.error("GitHub Upload Error:", error.response ? error.response.data : error.message);
        throw error;
    }
}

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
    
    // التحقق من أن المستخدم في القائمة المسموح بها
    if (!AUTHORIZED_USERS.includes(chatId)) {
        bot.sendMessage(chatId, "⛔ عذراً، هذا البوت للإدارة فقط ولست مخولاً باستخدامه.");
        return;
    }

    bot.sendMessage(chatId, "👋 أهلاً بك في نظام MecWeb.\n\n📄 *لرفع ملف:* أرسل الملف مباشرة.\n📝 *لرسالة للطلاب:* اكتب النص وسأقوم بنشره كإشعار.", { parse_mode: 'Markdown' });
});

// --- أ) عند استلام ملف ---
bot.on('document', async (msg) => handleFile(msg));
bot.on('photo', async (msg) => {
    const photo = msg.photo[msg.photo.length - 1];
    handleFile({ ...msg, document: photo, caption: msg.caption || "صورة" });
});

async function handleFile(msg) {
    const chatId = msg.chat.id;
    
    // التحقق من الصلاحية
    if (!AUTHORIZED_USERS.includes(chatId)) return;

    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name || "ملف_" + Date.now();

    // حفظ الحالة ونوع العملية (ملف)
    userStates[chatId] = {
        step: 'select_subject',
        type: 'file', // نوع العملية: ملف
        file: { id: fileId, name: fileName }
    };

    const data = await getDatabase();
    if (!data || !data.database) { return bot.sendMessage(chatId, "❌ خطأ في قاعدة البيانات."); }

    const subjects = Object.keys(data.database);
    const keyboard = subjects.map(sub => [{ text: sub, callback_data: `sub_${sub}` }]);
    bot.sendMessage(chatId, `📂 الملف: *${fileName}*\n\nاختر المادة:`, {
        reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown'
    });
}

// --- ب) عند استلام نص ---
bot.on('text', (msg) => {
    // تجاهل الأوامر مثل /start
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;

    // التحقق من الصلاحية
    if (!AUTHORIZED_USERS.includes(chatId)) return;

    // حفظ الحالة ونوع العملية (نص إشعار)
    userStates[chatId] = {
        step: 'select_subject',
        type: 'text', // نوع العملية: نص
        content: msg.text // حفظ النص نفسه
    };

    getDatabase().then(data => {
        if (!data || !data.database) { return bot.sendMessage(chatId, "❌ خطأ في قاعدة البيانات."); }
        const subjects = Object.keys(data.database);
        const keyboard = subjects.map(sub => [{ text: sub, callback_data: `sub_${sub}` }]);
        bot.sendMessage(chatId, `📝 رسالة جديدة\n\nالنص: "${msg.text}"\n\nاختر المادة:`, {
            reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown'
        });
    });
});


// ==========================================
// 4. التعامل مع اختيار الأزرار
// ==========================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates[chatId];

    // ⭐ تحقق إضافي عند الضغط على الأزرار
    if (!AUTHORIZED_USERS.includes(chatId)) {
        return bot.answerCallbackQuery(query.id, { text: "⛔ غير مصرح لك", show_alert: true });
    }

    if (!state) return bot.answerCallbackQuery(query.id, { text: "أرسل الملف أو النص مرة أخرى.", show_alert: true });

    // اختيار المادة (مشترك للملف والنص)
    if (state.step === 'select_subject' && data.startsWith('sub_')) {
        const subjectName = data.replace('sub_', '');
        state.subject = subjectName; state.step = 'select_doctor';
        const db = await getDatabase();
        const doctors = db.database[subjectName]?.doctors || [];
        const keyboard = doctors.map(doc => [{ text: doc, callback_data: `doc_${doc}` }]);
        bot.editMessageText(`المادة: *${subjectName}*\n\nاختر الدكتور:`, {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown'
        });
    }
    // اختيار الدكتور
    else if (state.step === 'select_doctor' && data.startsWith('doc_')) {
        const doctorName = data.replace('doc_', '');
        state.doctor = doctorName;

        // --- إذا كان النوع نص، نتجاهل اختيار القسم ونرفع مباشرة ---
        if (state.type === 'text') {
            bot.answerCallbackQuery(query.id, { text: "جاري إرسال الإشعار... ⏳" });
            await processTextNotification(chatId, state, query.message.message_id);
        } 
        // --- إذا كان ملف، نكمل العادي ونسأل عن القسم ---
        else {
            state.step = 'select_section';
            const db = await getDatabase();
            const sections = db.database[state.subject][state.doctor]?.sections || [];
            const keyboard = sections.map(sec => [{ text: sec, callback_data: `sec_${sec}` }]);
            bot.editMessageText(`الدكتور: *${doctorName}*\n\nاختر القسم:`, {
                chat_id: chatId, message_id: query.message.message_id,
                reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown'
            });
        }
    }
    // اختيار القسم (يحدث فقط للملفات) - *** تم التعديل هنا ***
    else if (state.step === 'select_section' && data.startsWith('sec_')) {
        const sectionName = data.replace('sec_', '');
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        
        bot.answerCallbackQuery(query.id, { text: "⏳ جاري معالجة الملف..." });

        try {
            // 1. تنزيل الملف من تليجرام مؤقتاً
            const fileLink = await getTelegramFileLink(state.file.id);
            // استخدم مسار /tmp/ للمنصات المجانية (مثل Railway)
            const tempFilePath = `/tmp/temp_${state.file.name}`;
            
            // استخدام axios لتنزيل الملف كـ Stream
            const response = await axios({
                method: 'get',
                url: fileLink,
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(tempFilePath);
            response.data.pipe(writer);

            // انتظار انتهاء التنزيل
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 2. رفع الملف إلى GitHub
            bot.editMessageText(chatId, messageId, "⏳ جاري الرفع إلى GitHub... يرجى الانتظار...");
            
            const githubLink = await uploadToGithubRelease(tempFilePath, state.file.name);

            // 3. حذف الملف المؤقت من السيرفر
            fs.unlinkSync(tempFilePath);

            if (!githubLink) throw new Error("فشل الحصول على رابط GitHub");

            // 4. حفظ الرابط الجديد في قاعدة البيانات
            const db = await getDatabase();
            if (db.database[state.subject]?.[state.doctor]?.[sectionName]) {
                db.database[state.subject][state.doctor][sectionName].push({ name: state.file.name, link: githubLink });
                
                await saveDatabase(db);
                bot.editMessageText(chatId, messageId, `✅ تم الرفع بنجاح!\n\n📂 ${state.subject}\n👨‍🏫 ${state.doctor}\n📁 ${sectionName}\n\n🔗 الرابط تم حفظه في GitHub.`, { parse_mode: 'Markdown' });
                delete userStates[chatId];
            } else {
                bot.sendMessage(chatId, "❌ المسار غير صحيح في قاعدة البيانات.");
            }

        } catch (error) {
            console.error("Error in file handling:", error);
            bot.sendMessage(chatId, `❌ حدث خطأ: ${error.message}`);
        }
    }
});

// ==========================================
// 5. دالة خاصة لرفع النصوص (تخطي القسم)
// ==========================================

async function processTextNotification(chatId, state, messageId) {
    const db = await getDatabase();
    
    // التأكد من وجود قسم الإشعارات
    if (!db.database[state.subject][state.doctor]["🔔 Notifications"]) {
        if (!db.database[state.subject][state.doctor].sections) {
            db.database[state.subject][state.doctor].sections = [];
        }
        if (!db.database[state.subject][state.doctor].sections.includes("🔔 Notifications")) {
            db.database[state.subject][state.doctor].sections.unshift("🔔 Notifications");
        }
        db.database[state.subject][state.doctor]["🔔 Notifications"] = [];
    }

    // إضافة النص كإشعار جديد
    db.database[state.subject][state.doctor]["🔔 Notifications"].unshift({
        name: state.content,
        date: new Date().toLocaleString(),
        type: "notif",
        id: Date.now().toString()
    });

    try {
        await saveDatabase(db);
        bot.editMessageText(`✅ تم إرسال الإشعار!\n\n📂 ${state.subject}\n👨‍🏫 ${state.doctor}\n📁 الإشعارات\n\n"${state.content}"`, {
            chat_id: chatId, 
            message_id: messageId, 
            parse_mode: 'Markdown'
        });
        delete userStates[chatId];
    } catch (err) {
        bot.sendMessage(chatId, "❌ فشل إرسال الإشعار.");
        console.error(err);
    }
}