const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

// ===========================
// 1. إعداد البيانات (Configuration)
// ===========================
const CONFIG_FILE = path.join(__dirname, 'config.json');

function setupConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } else {
        console.log("=== مرحباً بك في إعداد البوت لأول مرة ===");
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

        (async () => {
            console.log("\nيرجى إدخال البيانات التالية من مصادرها (BotFather, GitHub, JSONBin):\n");
            const botToken = await question('1. أدخل توكن تليجرام (من @BotFather): ');
            const githubToken = await question('2. أدخل توكن GitHub (Classic): ');
            const githubOwner = await question('3. أدخل اسم مستخدم GitHub Owner (Username): ');
            const githubRepo = await question('4. أدخل اسم المستودع GitHub Repo Name: ');
            const adminId = await question('5. أدخل رقم الأدمن (ID): ');

            // بيانات JSONBin موجودة في الكود المرسل، لكن نطلبها للتأكد
            const jsonBinId = "696e77bfae596e708fe71e9d"; 
            const jsonBinKey = "$2a$10$TunKuA35QdJp478eIMXxRunQfqgmhDY3YAxBXUXuV/JrgIFhU0Lf2";

            const config = {
                TELEGRAM_TOKEN: botToken,
                GITHUB_TOKEN: githubToken,
                GITHUB_OWNER: githubOwner,
                GITHUB_REPO: githubRepo,
                JSONBIN_ID: jsonBinId,
                JSONBIN_KEY: jsonBinKey,
                ADMIN_ID: parseInt(adminId)
            };

            fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
            console.log('\n✅ تم حفظ الإعدادات بنجاح في ملف config.json!');
            console.log('⚠️ يرجى إعادة تشغيل البوت الآن (Ctrl+C ثم node index.js)');
            rl.close();
            process.exit(0);
        })();
        return null;
    }
}

// تشغيل الإعدادات
const config = setupConfig();
if (!config) return;

const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
const userStates = {}; 

console.log(`✅ البوت يعمل الآن! متصل بالمستودع: ${config.GITHUB_OWNER}/${config.GITHUB_REPO}`);

// ===========================
// 2. دوال قاعدة البيانات (JSONBin)
// ===========================
async function getDatabase() {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': config.JSONBIN_KEY, 'X-Bin-Meta': 'false' }
        });
        return response.data;
    } catch (error) {
        console.error("خطأ في جلب البيانات:", error.response ? error.response.data : error.message);
        return null;
    }
}

async function saveDatabase(data) {
    try {
        // نحافظ على باقي الإعدادات (Config العامة للموقع) ونحدث الـ Database فقط
        // ولكن للبوت سنقوم بتحديث كامل الـ Object بما يحتويه من database و config
        await axios.put(`https://api.jsonbin.io/v3/b/${config.JSONBIN_ID}`, data, {
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': config.JSONBIN_KEY }
        });
        console.log("✅ تم تحديث قاعدة البيانات والبيانات المنشورة للطلاب.");
    } catch (error) {
        console.error("خطأ في حفظ البيانات:", error.response ? error.response.data : error.message);
        throw error;
    }
}

async function getTelegramFileLink(fileId) {
    try {
        const file = await bot.getFile(fileId);
        return `https://api.telegram.org/file/bot${config.TELEGRAM_TOKEN}/${file.file_path}`;
    } catch (error) {
        console.error("خطأ في رابط الملف:", error.message);
        return null;
    }
}

// ===========================
// 3. دالة رفع GitHub Releases
// ===========================
async function uploadToGithubRelease(filePath, fileName) {
    try {
        const tag = `v_${fileName.replace(/\./g, '_')}_${Date.now()}`;
        const releaseUrl = `https://api.github.com/repos/${config.GITHUB_OWNER}/${config.GITHUB_REPO}/releases`;
        
        let releaseId;

        // محاولة إنشاء Release جديد
        try {
            const createResp = await axios.post(releaseUrl, {
                tag_name: tag,
                name: fileName,
                body: `Uploaded via Bot`,
                draft: false,
                prerelease: false
            }, { headers: { 'Authorization': `token ${config.GITHUB_TOKEN}` } });
            releaseId = createResp.data.id;
        } catch (createError) {
            // إذا فشل (التاغ موجود)، جلب آخر Release
            console.log("⚠️ فشل إنشاء Release جديد، محاولة استخدام آخر Release موجود...");
            try {
                const listResp = await axios.get(releaseUrl, { headers: { 'Authorization': `token ${config.GITHUB_TOKEN}` } });
                if (listResp.data && listResp.data.length > 0) {
                    releaseId = listResp.data[0].id;
                } else {
                    throw new Error("لا توجد Releases لرفع الملف إليها.");
                }
            } catch (listError) {
                throw new Error("لا يمكن الوصول إلى GitHub Releases.");
            }
        }

        // الحصول على رابط الرفع
        const releaseData = await axios.get(`${releaseUrl}/${releaseId}`, { headers: { 'Authorization': `token ${config.GITHUB_TOKEN}` } });
        const uploadUrl = releaseData.data.upload_url;

        // رفع الملف
        const fileStream = fs.createReadStream(filePath);
        const formData = new FormData();
        formData.append('file', fileStream);

        const uploadResp = await axios.post(uploadUrl, formData, {
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            headers: {
                ...formData.getHeaders(),
                'Authorization': `token ${config.GITHUB_TOKEN}`
            }
        });

        if (uploadResp.status === 201 || uploadResp.status === 200) {
            return `https://github.com/${config.GITHUB_OWNER}/${config.GITHUB_REPO}/releases/download/${tag}/${fileName}`;
        } else {
            throw new Error(`فشل الرفع: Code ${uploadResp.status}`);
        }

    } catch (error) {
        console.error("=== تفاصيل خطأ GitHub ===");
        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Data:", JSON.stringify(error.response.data));
        } else {
            console.log("Message:", error.message);
        }
        throw error;
    }
}

// ===========================
// 4. التعامل مع تليجرام (Events)
// ===========================
bot.onText(/\/start/, (msg) => {
    if (msg.chat.id !== config.ADMIN_ID) {
        bot.sendMessage(msg.chat.id, "⛔ ليس لديك صلاحية الدخول.");
        return;
    }
    bot.sendMessage(msg.chat.id, "👋 أهلاً بك في نظام الإدارة!\n\n📂 أرسل ملفاً لرفعه وعرضه للطلاب.\n📝 أرسل نصاً لإشعار الدكتور (مثال: @دكتورأحمد المحاضرة ملغاة).");
});

bot.on('text', (msg) => {
    if (msg.text.startsWith('/') || msg.chat.id !== config.ADMIN_ID) return;
    
    userStates[msg.chat.id] = { step: 'send_text', content: msg.text };
    bot.sendMessage(msg.chat.id, "⏳ جاري معالجة الإشعار...");
    processTextNotification(msg.chat.id, msg.text, msg.message_id);
});

bot.on('document', (msg) => handleFile(msg));

bot.on('photo', async (msg) => {
    if (msg.chat.id !== config.ADMIN_ID) return;
    const photo = msg.photo[msg.photo.length - 1];
    // تحويل الصورة لمستند وهمي
    handleFile({
        chat: msg.chat,
        document: {
            file_id: photo.file_id,
            file_name: `photo_${Date.now()}.jpg`
        },
        message_id: msg.message_id
    });
});

async function handleFile(msg) {
    const chatId = msg.chat.id;
    if (chatId !== config.ADMIN_ID) return;

    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name || `file_${Date.now()}`;

    userStates[chatId] = {
        step: 'select_subject',
        type: 'file',
        file: { id: fileId, name: fileName }
    };

    const db = await getDatabase();
    if (!db || !db.database) {
        return bot.sendMessage(chatId, "❌ قاعدة البيانات فارغة.");
    }
    
    const subjects = Object.keys(db.database);
    if (subjects.length === 0) return bot.sendMessage(chatId, "❌ لا توجد مواد متاحة في الموقع.");

    const keyboard = subjects.map(sub => [{ text: sub, callback_data: `sub_${sub}` }]);
    bot.sendMessage(chatId, `📂 الملف: ${fileName}\n\nاختر المادة:`, {
        reply_markup: { inline_keyboard: keyboard }
    });
}

// ===========================
// 5. معالجة الأزرار (Callback Queries)
// ===========================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates[chatId];

    if (chatId !== config.ADMIN_ID) return;
    if (!state) return bot.answerCallbackQuery(query.id, { text: "انتهت الجلسة، أرسل الملف مرة أخرى." });

    // اختيار المادة
    if (state.step === 'select_subject' && data.startsWith('sub_')) {
        const subjectName = data.replace('sub_', '');
        state.subject = subjectName;
        state.step = 'select_doctor';

        const db = await getDatabase();
        // دعم الهيكل القديم والجديد (الموقع يستخدم doctors array أحياناً ومفاتيح مباشرة أحياناً)
        let doctors = [];
        if (db.database[subjectName] && db.database[subjectName].doctors) {
            doctors = db.database[subjectName].doctors;
        } else if (typeof db.database[subjectName] === 'object') {
            doctors = Object.keys(db.database[subjectName]).filter(k => k !== 'doctors');
        }

        if (doctors.length === 0) {
            // إذا لم يوجد أطباء، نضيف واحداً افتراضياً
            bot.answerCallbackQuery(query.id, { text: "لا يوجد أطباء، سيتم الرفع في General..." });
            state.doctor = "General";
            state.sectionName = "General";
            await handleFileUpload(chatId, state, query.message.message_id);
            return;
        }

        const keyboard = doctors.map(doc => [{ text: doc, callback_data: `doc_${doc}` }]);
        bot.editMessageText(`المادة: ${subjectName}\nاختر الدكتور:`, {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // اختيار الدكتور
    else if (state.step === 'select_doctor' && data.startsWith('doc_')) {
        const doctorName = data.replace('doc_', '');
        state.doctor = doctorName;
        
        if (state.type === 'text') {
            processTextNotificationInternal(chatId, state.content, query.message.message_id, state.subject, doctorName);
        } else {
            state.step = 'select_section';
            
            const db = await getDatabase();
            const doctorObj = db.database[state.subject][state.doctor];
            let sections = [];
            
            if (doctorObj && doctorObj.sections) {
                sections = doctorObj.sections;
            } else if (typeof doctorObj === 'object') {
                sections = Object.keys(doctorObj).filter(k => k !== 'sections');
            }

            if (sections.length === 0) {
                bot.answerCallbackQuery(query.id, { text: "⏳ لا توجد أقسام، سيتم الرفع في General..." });
                state.sectionName = "General";
                await handleFileUpload(chatId, state, query.message.message_id);
                return;
            }

            const keyboard = sections.map(sec => [{ text: sec, callback_data: `sec_${sec}` }]);
            bot.editMessageText(`الدكتور: ${doctorName}\nاختر القسم:`, {
                chat_id: chatId, message_id: query.message.message_id,
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    }

    // اختيار القسم
    else if (state.step === 'select_section' && data.startsWith('sec_')) {
        const sectionName = data.replace('sec_', '');
        state.sectionName = sectionName;
        bot.answerCallbackQuery(query.id, { text: "⏳ جاري الرفع..." });
        await handleFileUpload(chatId, state, query.message.message_id);
    }
});

// ===========================
// 6. تنفيذ العمليات (Upload & Save)
// ===========================
async function handleFileUpload(chatId, state, messageId) {
    try {
        const fileId = state.file.id;
        const fileName = state.file.name;

        // 1. تنزيل من تليجرام
        bot.sendMessage(chatId, "⬇️ جاري تحميل الملف من تليجرام...");
        const fileLink = await getTelegramFileLink(fileId);
        const tempPath = path.join(__dirname, `temp_${fileName}`);
        
        const response = await axios({ method: 'get', url: fileLink, responseType: 'stream' });
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 2. رفع لـ GitHub
        bot.sendMessage(chatId, "☁️ جاري رفع الملف لـ GitHub...");
        const githubLink = await uploadToGithubRelease(tempPath, fileName);
        
        // 3. حذف الملف المؤقت
        fs.unlinkSync(tempPath);

        if (!githubLink) throw new Error("فشل الحصول على الرابط");

        // 4. التحديث والحفظ في JSONBin
        const db = await getDatabase();
        
        // التأكد من بنية البيانات (Subject -> Doctor -> Section)
        if (!db.database[state.subject]) db.database[state.subject] = {};
        if (!db.database[state.subject][state.doctor]) {
            db.database[state.subject][state.doctor] = { sections: [] };
        }
        if (!db.database[state.subject][state.doctor][state.sectionName]) {
            db.database[state.subject][state.doctor][state.sectionName] = [];
        }

        // إضافة الملف للقسم
        db.database[state.subject][state.doctor][state.sectionName].push({
            name: fileName,
            link: githubLink,
            date: new Date().toLocaleString()
        });

        await saveDatabase(db);

        // 5. النتيجة
        bot.editMessageText(chatId, messageId, 
            `✅ تم الرفع بنجاح!\n\n🔗 [رابط التحميل](${githubLink})`, 
            { parse_mode: 'Markdown' }
        );
        delete userStates[chatId];

    } catch (error) {
        console.error(error);
        bot.sendMessage(chatId, `❌ فشل الرفع: ${error.message}\n(تفاصيل الخطأ في الـ Console)`);
    }
}

async function processTextNotification(chatId, content, messageId) {
    const match = content.match(/@(\w+)/);
    if (match) {
        const doctorName = match[1];
        // الافتراض: الإشعارات تذهب لمادة General أو مادة موجودة
        // للتبسيط سنبحث في كل المواد عن الدكتور
        await processTextNotificationInternal(chatId, content, messageId, "General", doctorName);
    } else {
        bot.sendMessage(chatId, "❌ الرجاء كتابة اسم الدكتور بعد @ (مثال: @DrName)");
    }
}

async function processTextNotificationInternal(chatId, text, messageId, subjectName, doctorName) {
    const db = await getDatabase();
    
    // البحث عن الدكتور في المادة
    if (!db.database[subjectName]) db.database[subjectName] = {};
    
    // إذا كان الدكتور غير موجود في General، سنحاول البحث عنه في المواد الأخرى (اختياري)
    // هنا سنلتزم بالمسار المطلوب
    if (!db.database[subjectName][doctorName]) {
        db.database[subjectName][doctorName] = { sections: ["🔔 Notifications"] };
    }
    if (!db.database[subjectName][doctorName]["🔔 Notifications"]) {
        db.database[subjectName][doctorName]["🔔 Notifications"] = [];
    }

    const fullDate = Date.now();
    const updateId = fullDate.toString() + "_" + Math.random().toString(36).substr(2,5);

    db.database[subjectName][doctorName]["🔔 Notifications"].unshift({
        id: updateId,
        name: text,
        date: new Date().toLocaleString(),
        type: "notif",
        fullDate: fullDate
    });

    // تحديث recentUpdates لتفعيل الإشعارات في التطبيق
    if (!db.recentUpdates) db.recentUpdates = [];
    db.recentUpdates.unshift({ id: updateId, doctor: doctorName, subject: subjectName, timestamp: fullDate });
    if (db.recentUpdates.length > 5) db.recentUpdates = db.recentUpdates.slice(0, 5);
    db.latestNotificationUpdate = fullDate;

    try {
        await saveDatabase(db);
        if (messageId) {
            try {
                bot.editMessageText(chatId, messageId, "✅ تم إرسال الإشعار!");
            } catch (e) {
                bot.sendMessage(chatId, "✅ تم إرسال الإشعار!");
            }
        } else {
            bot.sendMessage(chatId, "✅ تم إرسال الإشعار!");
        }
        delete userStates[chatId];
    } catch (err) {
        bot.sendMessage(chatId, "❌ فشل حفظ الإشعار.");
    }
}