# 🎬 hwto-kurd — منصة البث الترفيهية

منصة بث ويب حديثة وسريعة للأفلام، المسلسلات، والأنمي مع دعم كامل للترجمات الكردية والعربية، وتزامن سحابي عبر Firebase، وتشغيل محمي عبر سيرفر Vercel Serverless.

---

## 🌟 الميزات الرئيسية (Features)

- 🎨 **هوية بصرية جديدة (`hwto-kurd`)**: تصميم أنيق وتدرج ألوان بنفسجي حديث (`#852781` → `#402567`) مع شعار `hwto-kurd`.
- 🧭 **شريط تصنيفات علوي ذكي**:
  - **الرئيسية** (Home)
  - **أفلام** (Movies)
  - **مسلسلات** (TV Series)
  - **جديد** (Trending & New Releases)
  - **انمي** (Anime)
  - **اسيوي** (K-Drama & Asian)
  - **هندي** (Bollywood / Indian)
  - **تركي** (Turkish Series & Movies)
- 📜 **تصفح مرن مع زر "عرض المزيد" (Pagination)**: تحميل سلس للنتائج مع إمكانية الفرز حسب الأحدث، الأعلى تقييماً، أو الأكثر شعبية.
- 🔒 **حماية الـ API وإخفاء المفاتيح**:
  - لا حاجة للمستخدمين لإدخال أي مفاتيح API نهائياً.
  - جميع طلبات TMDB تمر عبر سيرفر وسيط آمن (`api/tmdb.js`) على Vercel مع تحديد معدل الطلبات وحجب المواقع الخارجية.
- ⚽ **مصدر رياضي احتياطي**:
  - يستخدم hwto-sport واجهة `worldcup26.ir` أولاً، ولا يستدعي API-Football إلا إذا فشل الطلب الأساسي؛ النتائج الفارغة لا تستهلك حصة إضافية.
  - جميع طلبات API-Football تمر عبر `api/football.js` بقائمة مسارات ودوريات مسموحة وتخزين مؤقت؛ لا يُطلب المفتاح من المتصفح.
- 👤 **تسجيل الدخول والتزامن السحابي (Firebase & Cloud Firestore)**:
  - تسجيل حساب جديد أو الدخول بالبريد وكلمة المرور أو حساب Google أو الدخول السريع كزائر.
  - حفظ وتزامن المفضلة (Watchlist) وسجل المشاهدة وتقدم الفيديو تلقائياً عبر السحابة.
- 🌐 **حقن الترجمة الكردية والعربية تلقائياً عبر GitHub**:
  - فحص تلقائي لمستودع الترجمات على GitHub لكل فيلم أو حلقة.
  - حقن رابط الترجمة المباشر في مشغل السيرفر ليعمل فور بدء التشغيل.
- 📱 **متجاوب بالكامل مع الهواتف الذكية (Mobile Responsive)**: شريط تنقل سفلي مرن وقوائم أفقية سلسة للموبايل والشاشات الصغيرة.

---

## 🚀 دليل النشر على Vercel عبر GitHub (Deployment Guide)

### 1. رفع المشروع إلى GitHub
```bash
# تهيئة المستودع وإضافة الملفات
git init
git add .
git commit -m "Initial commit for hwto-kurd"

# ربط المستودع بحسابك على GitHub
git branch -M main
git remote add origin https://github.com/<your-username>/hwto-kurd.git
git push -u origin main
```

> [!IMPORTANT]
> ملف `.gitignore` يقوم تلقائياً بحماية ملفاتك المحلية (`.env` و `firebase.txt`) من الرفع إلى GitHub لحماية بياناتك.

---

### 2. الربط مع Vercel
1. سجّل الدخول إلى موقع [Vercel](https://vercel.com).
2. انقر على **"Add New Project"** واختر مستودع `hwto-kurd` من حسابك في GitHub.
3. في إعدادات المشروع (Project Settings):
   - **Framework Preset**: سيتم التعرف عليه تلقائياً كـ **Vite**.
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. في قسم **Environment Variables** (المتغيرات البيئية)، أضف المتغير التالي:
   - **الاسم (Key)**: `TMDB_TOKEN`
   - **القيمة (Value)**: `ضع رمز TMDB Read Access Token الخاص بك هنا`
5. أضف `API_FOOTBALL_KEY` وضع المفتاح الجديد من حساب API-Football كقيمة. لا تستخدم بادئة `VITE_` لهذا المفتاح.
6. انقر على **Deploy**. سيصبح موقعك متاحاً ويعمل بكامل ميزاته خلال أقل من دقيقة!

للتشغيل المحلي، ضع `API_FOOTBALL_KEY` في `.env` (انسخ أسماء المتغيرات من `.env.example`) ثم أعد تشغيل Vite. يتطلب إصدار Electron المنشور رابط proxy عامّاً في `VITE_API_FOOTBALL_PROXY_URL` وقت البناء؛ ضع الرابط فقط، وليس المفتاح. لا تضمّن المفتاح في `VITE_*` أو في كود الواجهة لأن محتوياتها تكون عامة.

---

## 📝 إعداد قواعد أمان Firebase Firestore

بيانات التزامن السحابي لمشروعك مرتبطة بقاعدة بيانات Firestore الخاصة بـ `hwto-kurd`.
لضمان أمان بيانات كل مستخدم، قم بنسخ القواعد الموجودة في ملف `firestore.rules` ولصقها في وحدة تحكم Firebase:

1. افتح [Firebase Console](https://console.firebase.google.com/).
2. اختر مشروعك: **hwto-kurd**.
3. ادخل إلى **Build** ثم **Firestore Database**، ثم تبويب **Rules**.
4. استبدل المحتوى بالقاعدة التالية واضغط **Publish**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 🌍 رفع وإدارة الترجمات الكردية والعربية على GitHub

يدعم المشغل اكتشاف وحقن الترجمات تلقائياً من مستودع GitHub مخصص.

المستودع الافتراضي هو:
`https://github.com/hwto-kurd/subtitles`

### هيكلية الملفات المطلوبة في مستودع الترجمات:
أنشئ المجلدات والملفات داخل المستودع بالصيغة التالية (امتداد `.vtt` أو `.srt`):

#### للأفلام (Movies):
```text
subtitles/
  └── movie/
      └── {tmdb_id}/
          ├── ku.vtt    <-- ترجمة كردية للفيلم
          └── ar.vtt    <-- ترجمة عربية للفيلم
```
*مثال:* لفيلم رقم TMDB الخاص به هو `550`:
`subtitles/movie/550/ku.vtt`

#### للمسلسلات والحلقات (Series & Episodes):
```text
subtitles/
  └── tv/
      └── {tmdb_id}/
          └── s{season}e{episode}/
              ├── ku.vtt    <-- ترجمة كردية للحلقة
              └── ar.vtt    <-- ترجمة عربية للحلقة
```
*مثال:* لمسلسل برقم TMDB هو `1399`، الموسم الأول، الحلقة الأولى:
`subtitles/tv/1399/s1e1/ku.vtt`

> [!TIP]
> المشغل يبحث تلقائياً بالترتيب: اللغة المفضلة للمستخدم → اللغة الكردية (`ku`) → اللغة العربية (`ar`).
> بمجرد رفع ملف الترجمة بالمسار الصحيح، سيقوم الموقع تلقائياً باكتشافه وتضمينه داخل المشغل فوراً دون الحاجة لأي تعديل في الكود!

---

## 🛠️ التشغيل والتطوير المحلي (Local Development)

```bash
# تثبيت الحزم
npm install

# تشغيل خادم التطوير المحلي
npm run dev
```

افتح المتصفح على: `http://localhost:5173`

---

## 📄 الترخيص
تم تطوير هذا المشروع وإعادة تصميمه لصالح **hwto-kurd**.
