const LANGUAGE_KEY = 'hwto:language';
const LANGUAGES = {
  ar: { label: 'العربية', name: 'العربية', dir: 'rtl' },
  ckb: { label: 'کوردی', name: 'کوردی', dir: 'rtl' },
  en: { label: 'English', name: 'English', dir: 'ltr' }
};

const entries = [
  ['الرئيسية', 'Home', 'سەرەکی'],
  ['التصنيفات', 'Categories', 'پۆلەکان'],
  ['الرائجة', 'Trending', 'باو'],
  ['القادمة', 'Coming soon', 'بەم زووانە'],
  ['الأعلى تقييماً', 'Top rated', 'بە نمرەی بەرزتر'],
  ['مكتبة الموقع', 'Our library', 'کتێبخانەی ئێمە'],
  ['أنمي', 'Anime', 'ئەنیمە'],
  ['آسيوية', 'Asian', 'ئاسیایی'],
  ['تركية', 'Turkish', 'تورکی'],
  ['مسلسلات', 'TV series', 'زنجیرە'],
  ['أفلام', 'Movies', 'فیلمەکان'],
  ['أفلام رائجة', 'Trending movies', 'فیلمە باوەکان'],
  ['مسلسلات رائجة', 'Trending series', 'زنجیرە باوەکان'],
  ['ابحث عن فيلم أو مسلسل', 'Search movies and TV shows', 'گەڕان بەدوای فیلم و زنجیرەدا'],
  ['ابحث عن فيلم أو مسلسل…', 'Search movies and TV shows…', 'گەڕان بەدوای فیلم و زنجیرەدا…'],
  ['بحث', 'Search', 'گەڕان'],
  ['روابط الموقع', 'Site links', 'بەستەرەکانی ماڵپەڕ'],
  ['واجهة عصرية ترفيهية لمشاهدة واستكشاف أحدث الأفلام والمسلسلات بجودة عالية.', 'Discover and watch the latest movies and TV shows in high quality.', 'بەدوای نوێترین فیلم و زنجیرەکاندا بگەڕێ و بە کوالێتی بەرز سەیریان بکە.'],
  ['أفلام قادمة', 'Upcoming movies', 'فیلمەکانی داهاتوو'],
  ['جميع الحقوق محفوظة لـ hwto.kurd © — البيانات والصور مستوردة عبر واجهة TMDB.', 'All rights reserved © hwto.kurd — Data and images provided via TMDB.', 'هەموو مافەکان پارێزراون بۆ hwto.kurd © — داتا و وێنەکان لە ڕێگەی TMDB ـەوە دابین کراون.'],
  ['تخطَّ إلى المحتوى', 'Skip to content', 'بازدان بۆ ناوەڕۆک'],
  ['القائمة', 'Menu', 'لیست'],
  ['التنقل الرئيسي', 'Main navigation', 'ڕێدۆزی سەرەکی'],
  ['مسار التنقل', 'Breadcrumb navigation', 'ڕێدۆزی بەستەر'],
  ['لغة الموقع', 'Site language', 'زمانی ماڵپەڕ'],
  ['اللغة', 'Language', 'زمان'],
  ['لغة الموقع', 'Site language', 'زمانی ماڵپەڕ'],
  ['عرض الكل', 'View all', 'بینینی هەموو'],
  ['متوفر الآن', 'Available now', 'ئێستا بەردەستە'],
  ['شاهد الآن', 'Watch now', 'ئێستا سەیری بکە'],
  ['التفاصيل', 'Details', 'وردەکارییەکان'],
  ['تصفّح بقية المحتوى', 'Browse more', 'گەڕان لە ناوەڕۆکی زیاتر'],
  ['مختارات اليوم', "Today's picks", 'هەڵبژاردەکانی ئەمڕۆ'],
  ['الأكثر رواجاً الآن', 'Trending now', 'ئێستا زۆرترین بینراو'],
  ['الأكثر رواجاً الآن — صورة الغلاف غير متوفرة', 'Trending now — artwork unavailable', 'ئێستا زۆرترین بینراو — وێنەی پۆشەر بەردەست نییە'],
  ['لا يوجد وصف متوفر لهذا العنوان حالياً.', 'No description is available for this title.', 'ئێستا هیچ زانیارییەک بۆ ئەم ناونیشانە بەردەست نییە.'],
  ['جديد', 'New', 'نوێ'],
  ['إعادة المحاولة', 'Try again', 'دووبارە هەوڵ بدەرەوە'],
  ['عرض المزيد', 'Load more', 'زیاتر پیشان بدە'],
  ['جارٍ التحميل…', 'Loading…', 'بارکردن…'],
  ['جارٍ البحث…', 'Searching…', 'گەڕان…'],
  ['تعذّر تحميل المزيد', 'Could not load more', 'بارکردنی زیاتر سەرکەوتوو نەبوو'],
  ['لا يوجد محتوى لعرضه في الوقت الحالي.', 'There is no content to display right now.', 'لە ئێستادا هیچ ناوەڕۆکێک بۆ پیشاندان نییە.'],
  ['المكتبة فارغة', 'The library is empty', 'کتێبخانەکە بەتاڵە'],
  ['لا يوجد محتوى', 'No content', 'هیچ ناوەڕۆکێک نییە'],
  ['لم يُعثر على أي عنوان في هذا القسم.', 'No titles were found in this section.', 'هیچ ناونیشانێک لەم بەشەدا نەدۆزرایەوە.'],
  ['قد تكون البيانات قيد التحديث، أعد المحاولة بعد قليل.', 'The data may be updating. Please try again shortly.', 'لەوانەیە داتاکان نوێ بکرێنەوە؛ تکایە دواتر دووبارە هەوڵ بدەرەوە.'],
  ['لا توجد صورة', 'No image', 'وێنە نییە'],
  ['الرائجة — hwto.kurd', 'Trending — hwto.kurd', 'باو — hwto.kurd'],
  ['البحث — hwto.kurd', 'Search — hwto.kurd', 'گەڕان — hwto.kurd'],
  ['صفحة غير موجودة — hwto.kurd', 'Page not found — hwto.kurd', 'پەڕە نەدۆزرایەوە — hwto.kurd'],
  ['hwto.kurd — أفلام ومسلسلات', 'hwto.kurd — Movies & TV', 'hwto.kurd — فیلم و زنجیرە'],
  ['hwto.kurd — واجهة عصرية لاستكشاف الأفلام والمسلسلات الرائجة والقادمة والأعلى تقييماً.', 'hwto.kurd — A modern way to explore trending, upcoming, and top-rated movies and TV shows.', 'hwto.kurd — ڕێگایەکی نوێ بۆ گەڕان بەدوای فیلم و زنجیرە باو، داهاتوو و بەهەڵسەنگاندنی بەرزدا.'],
  ['تقييم الجمهور على TMDB', 'Audience ratings on TMDB', 'هەڵسەنگاندنی بینەران لە TMDB'],
  ['التقييم', 'Rating', 'هەڵسەنگاندن'],
  ['متوسط التقييم', 'Average rating', 'ناوەندی هەڵسەنگاندن'],
  ['تقييم', 'ratings', 'هەڵسەنگاندن'],
  ['قد يعجبك أيضاً', 'You may also like', 'لەوانەیە ئەمانەشت پێ خۆش بێت'],
  ['غير متوفر', 'Unavailable', 'بەردەست نییە'],
  ['هذا العنوان غير متوفر في قاعدة البيانات.', 'This title is unavailable in the database.', 'ئەم ناونیشانە لە بنکەدراوەدا بەردەست نییە.'],
  ['معرّف غير صالح.', 'Invalid ID.', 'ناسنامە نادروستە.'],
  ['بدون عنوان', 'Untitled', 'بێ ناونیشان'],
  ['الكل', 'All', 'هەموو'],
  ['جرّب: أكشن، دراما، أو اسم فيلم معروف', 'Try: action, drama, or a movie title', 'تاقی بکەرەوە: ئەکشن، دراما، یان ناوی فیلمێک'],
  ['ابحث داخل مكتبة الأفلام والمسلسلات', 'Search the movie and TV library', 'گەڕان لە کتێبخانەی فیلم و زنجیرە'],
  ['بحث — hwto.kurd', 'Search — hwto.kurd', 'گەڕان — hwto.kurd'],
  ['اكتب اسم فيلم أو مسلسل…', 'Type a movie or TV title…', 'ناوی فیلم یان زنجیرەیەک بنووسە…'],
  ['حقل البحث', 'Search field', 'خانەی گەڕان'],
  ['مسح البحث', 'Clear search', 'پاککردنەوەی گەڕان'],
  ['نوع النتائج', 'Result type', 'جۆری ئەنجام'],
  ['ترتيب حسب:', 'Sort by:', 'ڕیزکردن بەپێی:'],
  ['الافتراضي', 'Default', 'بنەڕەتی'],
  ['★ الأعلى تقييماً', '★ Top rated', '★ بەرزترین هەڵسەنگاندن'],
  ['📅 الأحدث', '📅 Newest', '📅 نوێترین'],
  ['🔤 أبجدياً', '🔤 Alphabetical', '🔤 ئەلفوبێیی'],
  ['نتيجة', 'results', 'ئەنجام'],
  ['تم عرض', 'Showing', 'پیشاندانی'],
  ['من', 'of', 'لە'],
  ['في المسلسلات', 'in TV shows', 'لە زنجیرەکاندا'],
  ['في الأفلام', 'in movies', 'لە فیلمەکاندا'],
  ['البحث', 'Search', 'گەڕان'],
  ['استخدم البحث', 'use search', 'گەڕان بەکاربهێنە'],
  ['اكتب كلمة لبدء البحث في المكتبة.', 'Type to search the library.', 'وشەیەک بنووسە بۆ گەڕان لە کتێبخانەکە.'],
  ['ابحث عن عنوان', 'Search for a title', 'گەڕان بەدوای ناونیشانێکدا'],
  ['في المسلسلات', 'in TV shows', 'لە زنجیرەکاندا'],
  ['في الأفلام', 'in movies', 'لە فیلمەکاندا'],
  ['لا نتائج', 'No results', 'هیچ ئەنجامێک نییە'],
  ['جرّب كلمة أقصر أو أزِل تصفية النوع.', 'Try a shorter query or clear the type filter.', 'وشەیەکی کورتتر تاقی بکەرەوە یان فلتەری جۆر لاببە.'],
  ['المشاهدة', 'Watch', 'بینین'],
  ['مشاهدة الفيلم', 'Watch movie', 'بینینی فیلم'],
  ['رجوع', 'Back', 'گەڕانەوە'],
  ['الترجمة:', 'Subtitles:', 'ژێرنووس:'],
  ['لغة الترجمة', 'Subtitle language', 'زمانی ژێرنووس'],
  ['المزامنة:', 'Sync:', 'هاوکاتکردن:'],
  ['تأخير 5 ثوانٍ', 'Delay by 5 seconds', '٥ چرکە دواخستن'],
  ['تأخير نصف ثانية', 'Delay by half a second', 'نیو چرکە دواخستن'],
  ['تقديم نصف ثانية', 'Advance by half a second', 'نیو چرکە پێشخستن'],
  ['تقديم 5 ثوانٍ', 'Advance by 5 seconds', '٥ چرکە پێشخستن'],
  ['إلغاء أي تعويض وإعادة الترجمة إلى 00:00 من هذه اللحظة', 'Clear the offset and restart subtitles at 00:00 now', 'لابردنی جیاوازی کات و دەستپێکردنەوەی ژێرنووس لە 00:00'],
  ['إعادة ضبط', 'Reset', 'ڕێکخستنەوە'],
  ['إخفاء الترجمة', 'Hide subtitles', 'شاردنەوەی ژێرنووس'],
  ['إظهار الترجمة', 'Show subtitles', 'پیشاندانی ژێرنووس'],
  ['نسخ رابط المشاهدة', 'Copy playback link', 'کۆپیکردنی بەستەری بینین'],
  ['نسخ الرابط', 'Copy link', 'کۆپیکردنی بەستەر'],
  ['خيارات التشغيل والتحميل', 'Playback and download options', 'هەڵبژاردەکانی بینین و داگرتن'],
  ['سيرفر التشغيل:', 'Playback server:', 'ڕاژەکاری بینین:'],
  ['سيرفرات التشغيل البديلة', 'Alternative playback servers', 'ڕاژەکارە جێگرەوەکانی بینین'],
  ['خيارات التحميل والتشغيل المباشر', 'Download and streaming options', 'هەڵبژاردەکانی داگرتن و پەخشکردنی ڕاستەوخۆ'],
  ['إغلاق', 'Close', 'داخستن'],
  ['رابط البث المباشر (جاهز لبرامج التحميل):', 'Stream link (ready for download apps):', 'بەستەری پەخشکردن (ئامادەیە بۆ بەرنامەکانی داگرتن):'],
  ['انسخ هذا الرابط والصقه في برامج التحميل مثل', 'Copy this link into a download manager such as', 'ئەم بەستەرە کۆپی بکە و لە بەرنامەی داگرتن وەک'],
  ['على الكمبيوتر أو', 'on desktop or', 'لە کۆمپیوتەر یان'],
  ['على الهاتف لتنزيل الفيديو مباشرة.', 'on mobile to download the video directly.', 'لە مۆبایل بۆ داگرتنی ڤیدیۆکە.'],
  ['⚡ برامج التحميل الخارجية (IDM / 1DM)', '⚡ Download managers (IDM / 1DM)', '⚡ بەرنامەکانی داگرتن (IDM / 1DM)'],
  ['افتح برنامج التحميل، اختر «إضافة رابط جديد»، والصق الرابط المنسوخ أعلاه وسيبدأ التحميل بأقصى سرعة.', 'Open your download manager, choose “Add new link”, and paste the copied link to start downloading.', 'بەرنامەی داگرتن بکەرەوە، «زیادکردنی بەستەری نوێ» هەڵبژێرە و بەستەرەکە بلکێنە بۆ دەستپێکردنی داگرتن.'],
  ['🎬 التشغيل في VLC Player', '🎬 Play in VLC Player', '🎬 پەخشکردن لە VLC Player'],
  ['في برنامج VLC، اختر', 'In VLC, choose', 'لە VLC، هەڵبژێرە'],
  ['وسائط ← افتح دفق شبكة', 'Media → Open Network Stream', 'میدیا ← کردنەوەی پەخشی تۆڕ'],
  ['والصق الرابط للتشغيل المباشر بدون إعلانات وبأعلى جودة.', 'and paste the link to stream without ads in the highest quality.', 'و بەستەرەکە بلکێنە بۆ پەخشکردن بە بێ ڕیکلام و بە باشترین کوالێتی.'],
  ['الحلقة السابقة', 'Previous episode', 'ئەڵقەی پێشوو'],
  ['الحلقة التالية', 'Next episode', 'ئەڵقەی داهاتوو'],
  ['المواسم والأجزاء', 'Seasons', 'وەرزەکان'],
  ['المواسم', 'Seasons', 'وەرزەکان'],
  ['اختيار الموسم والحلقة', 'Choose season and episode', 'هەڵبژاردنی وەرز و ئەڵقە'],
  ['انتقال مباشر:', 'Jump to:', 'بازدان بۆ:'],
  ['الموسم', 'Season', 'وەرز'],
  ['الحلقة', 'Episode', 'ئەڵقە'],
  ['التصنيفات', 'Categories', 'پۆلەکان'],
  ['الرائجة', 'Trending', 'باو'],
  ['مغامرة', 'Adventure', 'سەرکێشی'],
  ['فانتازيا', 'Fantasy', 'خەیاڵی'],
  ['أنيميشن', 'Animation', 'ئەنیمەیشن'],
  ['دراما', 'Drama', 'دراما'],
  ['رعب', 'Horror', 'ترسناک'],
  ['أكشن', 'Action', 'ئەکشن'],
  ['كوميديا', 'Comedy', 'کۆمیدی'],
  ['تاريخ', 'History', 'مێژوو'],
  ['ويسترن', 'Western', 'ڕۆژئاوایی'],
  ['إثارة', 'Thriller', 'هەستبزوێن'],
  ['جريمة', 'Crime', 'تاوان'],
  ['وثائقي', 'Documentary', 'بەڵگەنامەیی'],
  ['خيال علمي', 'Science fiction', 'زانستی خەیاڵی'],
  ['غموض', 'Mystery', 'نهێنی'],
  ['موسيقي', 'Music', 'مۆسیقا'],
  ['رومانسي', 'Romance', 'ڕۆمانسی'],
  ['عائلي', 'Family', 'خێزانی'],
  ['حرب', 'War', 'جەنگ'],
  ['أكشن ومغامرة', 'Action & adventure', 'ئەکشن و سەرکێشی'],
  ['واقعي', 'Reality', 'واقیعی'],
  ['خيال علمي وفانتازيا', 'Sci-fi & fantasy', 'زانستی خەیاڵی و فانتازیا'],
  ['حواري', 'Talk', 'گفتوگۆ'],
  ['حرب وسياسة', 'War & politics', 'جەنگ و سیاسەت'],
  ['العربية', 'Arabic', 'عەرەبی'],
  ['الإنجليزية', 'English', 'ئینگلیزی'],
  ['كردية', 'Kurdish', 'کوردی'],
  ['متوسط التقييم', 'Average rating', 'ناوەندی هەڵسەنگاندن'],
  ['تقييم الجمهور على TMDB', 'Audience rating on TMDB', 'هەڵسەنگاندنی بینەران لە TMDB'],
  ['أحدث إصدارات الأنمي', 'Latest anime releases', 'نوێترین دەرچوونەکانی ئەنیمە'],
  ['مسلسلات أنمي', 'Anime series', 'زنجیرەی ئەنیمە'],
  ['أفلام أنمي', 'Anime movies', 'فیلمی ئەنیمە'],
  ['آخر إضافات مكتبة الموقع', 'Recently added to our library', 'نوێترین زیادکراوەکانی کتێبخانە'],
  ['رائجة الآن', 'Trending now', 'ئێستا باوە'],
  ['قادمة إلى الصالات', 'Coming to theaters', 'بەم زووانە لە سینەماکان'],
  ['أحدث الإصدارات الآسيوية', 'Latest Asian releases', 'نوێترین دەرچوونە ئاسیاییەکان'],
  ['مسلسلات آسيوية', 'Asian TV series', 'زنجیرە ئاسیاییەکان'],
  ['أفلام آسيوية', 'Asian movies', 'فیلمە ئاسیاییەکان'],
  ['أحدث الإصدارات التركية', 'Latest Turkish releases', 'نوێترین دەرچوونە تورکییەکان'],
  ['مسلسلات تركية', 'Turkish TV series', 'زنجیرە تورکییەکان'],
  ['أفلام تركية', 'Turkish movies', 'فیلمە تورکییەکان'],
  ['أفلام ومسلسلات آسيوية', 'Asian movies & TV', 'فیلم و زنجیرە ئاسیاییەکان'],
  ['أفلام ومسلسلات شرق وجنوب آسيا: كوريا واليابان والصين والهند وتايلاند', 'East and South Asian movies and TV from Korea, Japan, China, India, and Thailand', 'فیلم و زنجیرەکانی ڕۆژهەڵات و باشووری ئاسیا: کۆریا، ژاپۆن، چین، هیندستان و تایلەند'],
  ['أفلام ومسلسلات تركية: دراما تاريخية وأكشن وكوميديا', 'Turkish movies and TV: historical drama, action, and comedy', 'فیلم و زنجیرە تورکییەکان: درامای مێژوویی، ئەکشن و کۆمیدی'],
  ['أفلام ومسلسلات أنمي مختارة بعناية — من ناروتو وآتاك أون تايتان حتى استوديو غيبلي', 'A hand-picked anime collection — from Naruto and Attack on Titan to Studio Ghibli', 'کۆمەڵە ئەنیمەیەکی هەڵبژێردراو — لە ناروتۆ و Attack on Titan تا ستۆدیۆ غیبلی'],
  ['كل مسلسلات الموقع: محتوى المكتبة والأعلى تقييماً والرائجة الآن في شاشة واحدة', 'All series in one place: library picks, top rated, and trending', 'هەموو زنجیرەکان لە یەک شوێندا: کتێبخانە، بەرزترین هەڵسەنگاندن و باوەکان'],
  ['كل أفلام الموقع: محتوى المكتبة والأعلى تقييماً وما هو قادم إلى الصالات في شاشة واحدة', 'All movies in one place: library picks, top rated, and upcoming releases', 'هەموو فیلمەکان لە یەک شوێندا: کتێبخانە، بەرزترین هەڵسەنگاندن و دەرچوونەکانی داهاتوو'],
  ['أفلام لم تُعرض بعد', 'Movies not yet released', 'فیلمەکانی هێشتا پیشان نەدراو'],
  ['حسب تقييم الجمهور على TMDB', 'By audience rating on TMDB', 'بەپێی هەڵسەنگاندنی بینەران لە TMDB'],
  ['محتوى محفوظ في قاعدة بيانات الموقع', 'Titles in our library database', 'ناوەڕۆکی تۆمارکراو لە بنکەدراوەی ماڵپەڕ'],
  ['مزيج من الأفلام والمسلسلات الأعلى تداولاً', 'A mix of the most talked-about movies and shows', 'تێکەڵەیەک لە فیلم و زنجیرە زۆر باسکراوەکان'],
  ['قريباً في الصالات', 'Coming to theaters', 'بەم زووانە لە سینەماکان'],
  ['الأعلى تقييماً — أفلام', 'Top rated — Movies', 'بەرزترین هەڵسەنگاندن — فیلم'],
  ['مكتبة الموقع — أفلام', 'Our library — Movies', 'کتێبخانە — فیلم'],
  ['مكتبة الموقع — مسلسلات', 'Our library — TV series', 'کتێبخانە — زنجیرە'],
  ['الأكثر رواجاً — مسلسلات', 'Trending — TV series', 'باوترین — زنجیرە'],
  ['المسلسلات الرائجة', 'Trending TV series', 'زنجیرە باوەکان'],
  ['الأفلام الرائجة', 'Trending movies', 'فیلمە باوەکان'],
  ['ما يشاهده الجمهور الآن', 'What people are watching now', 'ئەوەی خەڵک ئێستا دەیبینن'],
  ['إصدارات على وشك الوصول', 'Releases arriving soon', 'دەرچوونەکانی نزیک'],
  ['المسلسلات الأعلى تقييماً', 'Top rated TV series', 'زنجیرە بە بەرزترین هەڵسەنگاندن'],
  ['الأفلام الأعلى تقييماً', 'Top rated movies', 'فیلمە بە بەرزترین هەڵسەنگاندن'],
  ['مسلسلات مكتبة الموقع', 'TV series in our library', 'زنجیرەکانی کتێبخانە'],
  ['أفلام مكتبة الموقع', 'Movies in our library', 'فیلمەکانی کتێبخانە'],
  ['كل العناصر', 'All titles', 'هەموو ناونیشانەکان'],
  ['بحث', 'Search', 'گەڕان'],
  ['مسلسل', 'TV series', 'زنجیرە'],
  ['فيلم', 'Movie', 'فیلم'],
  ['صفحة غير موجودة', 'Page not found', 'پەڕە نەدۆزرایەوە'],
  ['لا توجد صفحة هنا', 'There is no page here', 'ئەم پەڕەیە لێرە نییە'],
  ['عد إلى الرئيسية أو استخدم البحث.', 'Go home or use search.', 'بگەڕێوە بۆ سەرەکی یان گەڕان بەکاربهێنە.'],
  ['تقييمات', 'ratings', 'هەڵسەنگاندن'],
  ['افتراضي', 'Default', 'بنەڕەتی'],
  ['الافتراضي', 'Default', 'بنەڕەتی'],
  ['عنوان رائج', 'Trending title', 'ناونیشانی باو'],
  ['قيد الإضافة', 'Coming soon', 'لە ڕێگای زیادکردنە'],
  ['إحصاءات المكتبة', 'Library statistics', 'ئامارەکانی کتێبخانە'],
  ['بحث', 'Search', 'گەڕان'],
  ['أنمي', 'Anime', 'ئەنیمە'],
  ['آسيوية', 'Asian', 'ئاسیایی'],
  ['تركية', 'Turkish', 'تورکی'],
  ['إسبانيا', 'Spain', 'ئیسپانیا'],
  ['بريطانيا', 'United Kingdom', 'بەریتانیا'],
  ['اليابان', 'Japan', 'ژاپۆن'],
  ['كوريا الجنوبية', 'South Korea', 'کۆریای باشوور'],
  ['تركيا', 'Turkey', 'تورکیا'],
  ['الولايات المتحدة', 'United States', 'ویلایەتە یەکگرتووەکان'],
  ['الصين', 'China', 'چین'],
  ['معرّف غير صالح.', 'Invalid ID.', 'ناسنامە نادروستە.'],
  ['لا يوجد وصف محفوظ لهذا العنوان في قاعدة البيانات.', 'No description is saved for this title in the database.', 'هیچ زانیارییەک بۆ ئەم ناونیشانە لە بنکەدراوەدا تۆمار نەکراوە.'],
  ['بعض البيانات التفصيلية غير متوفرة حالياً، المعروض مأخوذ من فهرس القوائم.', 'Some details are unavailable; this information comes from the catalog.', 'هەندێک وردەکاری بەردەست نییە؛ زانیارییەکان لە لیستی ناونیشانەکانەوە وەرگیراون.'],
  ['اختر الموسم والحلقة لمشاهدة البث مباشرة، أو استخدم الانتقال السريع لأي حلقة', 'Choose a season and episode to watch, or jump directly to any episode.', 'وەرز و ئەڵقە هەڵبژێرە بۆ بینین، یان ڕاستەوخۆ بازبدە بۆ هەر ئەڵقەیەک.'],
  ['المواسم والأجزاء', 'Seasons', 'وەرزەکان'],
  ['حلقات الموسم', 'Season episodes', 'ئەڵقەکانی وەرز'],
  ['انتقال مباشر لحلقة معينة:', 'Jump to an episode:', 'بازدان بۆ ئەڵقەیەک:'],
  ['مشاهدة مباشرة', 'Watch now', 'ئێستا سەیری بکە'],
  ['تشغيل', 'Play', 'پەخشکردن'],
  ['▶ مشاهدة', '▶ Watch', '▶ بینین'],
  ['اللغة:', 'Language:', 'زمان:'],
  ['بلد الإنتاج:', 'Country:', 'وڵاتی بەرهەمهێنان:'],
  ['لا يوجد وصف متوفر لهذا العنوان حالياً.', 'No description is available for this title.', 'ئێستا هیچ زانیارییەک بۆ ئەم ناونیشانە بەردەست نییە.'],
  ['الكندية', 'Kannada', 'کانادایی'],
  ['الصينية', 'Chinese', 'چینی'],
  ['الفرنسية', 'French', 'فەرەنسی'],
  ['الإسبانية', 'Spanish', 'ئیسپانی'],
  ['اليابانية', 'Japanese', 'ژاپۆنی'],
  ['الكورية', 'Korean', 'کۆری'],
  ['التركية', 'Turkish', 'تورکی'],
  ['مغامرة', 'Adventure', 'سەرکێشی'],
  ['فانتازيا', 'Fantasy', 'فانتازیا'],
  ['أنيميشن', 'Animation', 'ئەنیمەیشن'],
  ['دراما', 'Drama', 'دراما'],
  ['رعب', 'Horror', 'ترسناک'],
  ['أكشن', 'Action', 'ئەکشن'],
  ['كوميديا', 'Comedy', 'کۆمیدی'],
  ['تاريخ', 'History', 'مێژوو'],
  ['ويسترن', 'Western', 'ڕۆژئاوایی'],
  ['إثارة', 'Thriller', 'هەستبزوێن'],
  ['جريمة', 'Crime', 'تاوان'],
  ['وثائقي', 'Documentary', 'بەڵگەنامەیی'],
  ['خيال علمي', 'Science fiction', 'زانستی خەیاڵی'],
  ['غموض', 'Mystery', 'نهێنی'],
  ['موسيقي', 'Music', 'مۆسیقا'],
  ['رومانسي', 'Romance', 'ڕۆمانسی'],
  ['عائلي', 'Family', 'خێزانی'],
  ['حرب', 'War', 'جەنگ'],
  ['أكشن ومغامرة', 'Action & adventure', 'ئەکشن و سەرکێشی'],
  ['واقعي', 'Reality', 'واقیعی'],
  ['خيال علمي وفانتازيا', 'Sci-fi & fantasy', 'زانستی خەیاڵی و فانتازیا'],
  ['حواري', 'Talk', 'گفتوگۆ'],
  ['حرب وسياسة', 'War & politics', 'جەنگ و سیاسەت'],
  ['أفلام قادمة — hwto.kurd', 'Upcoming movies — hwto.kurd', 'فیلمەکانی داهاتوو — hwto.kurd'],
  ['أفلام — hwto.kurd', 'Movies — hwto.kurd', 'فیلمەکان — hwto.kurd'],
  ['مسلسلات — hwto.kurd', 'TV series — hwto.kurd', 'زنجیرە — hwto.kurd'],
  ['التصنيفات — hwto.kurd', 'Categories — hwto.kurd', 'پۆلەکان — hwto.kurd'],
  ['مشاهدة — hwto.kurd', 'Watch — hwto.kurd', 'بینین — hwto.kurd'],
  ['— أفلام ومسلسلات', '— Movies & TV', '— فیلم و زنجیرە'],
  ['لغة الموقع', 'Site language', 'زمانی ماڵپەڕ'],
  ['تم نسخ رابط البث المباشر بنجاح! جاهز للصق في IDM / 1DM / VLC', 'Stream link copied! Ready to paste into IDM / 1DM / VLC.', 'بەستەری پەخشکردن کۆپی کرا! ئامادەیە بۆ لکاندن لە IDM / 1DM / VLC.'],
  ['تم نسخ رابط البث المباشر بنجاح!', 'Stream link copied successfully!', 'بەستەری پەخشکردن بە سەرکەوتوویی کۆپی کرا!'],
  ['أُعيد ضبط الترجمة إلى البداية (00:00)', 'Subtitles reset to the beginning (00:00).', 'ژێرنووس گەڕێندرایەوە بۆ سەرەتا (00:00).'],
  ['هذا العنوان غير متوفر في قاعدة البيانات.', 'This title is unavailable in the database.', 'ئەم ناونیشانە لە بنکەدراوەدا بەردەست نییە.'],
  ['في السينما', 'In theaters', 'لە سینەما'],
  ['عنوان رائج', 'Trending title', 'ناونیشانی باو'],
  ['قيد الإضافة', 'Coming soon', 'لە ڕێگای زیادکردنە'],
  ['إحصاءات المكتبة', 'Library statistics', 'ئامارەکانی کتێبخانە'],
  ['اللغة:', 'Language:', 'زمان:'],
  ['بلد الإنتاج:', 'Country:', 'وڵاتی بەرهەمهێنان:'],
  ['شاهد الحلقة الأولى', 'Watch first episode', 'بینینی یەکەم ئەڵقە'],
  ['تصفح', 'Browse', 'گەڕان'],
  ['القصة', 'Story', 'چیرۆک'],
  ['لا يوجد وصف محفوظ لهذا العنوان في قاعدة البيانات.', 'No description for this title is saved in the database.', 'هیچ زانیارییەک بۆ ئەم ناونیشانە لە بنکەدراوەدا تۆمار نەکراوە.'],
  ['بعض البيانات التفصيلية غير متوفرة حالياً، المعروض مأخوذ من فهرس القوائم.', 'Some details are unavailable; the information shown comes from the catalog.', 'هەندێک وردەکاری بەردەست نییە؛ زانیارییە پیشاندراوەکان لە لیستی ناونیشانەکانەوە وەرگیراون.'],
  ['اختر الموسم والحلقة لمشاهدة البث مباشرة، أو استخدم الانتقال السريع لأي حلقة', 'Choose a season and episode to watch, or jump directly to any episode.', 'وەرز و ئەڵقە هەڵبژێرە بۆ بینین، یان ڕاستەوخۆ بازبدە بۆ هەر ئەڵقەیەک.'],
  ['حلقات الموسم', 'Season episodes', 'ئەڵقەکانی وەرز'],
  ['الموسم', 'Season', 'وەرز'],
  ['الافتراضي', 'Default', 'بنەڕەتی'],
  ['الأحدث', 'Newest', 'نوێترین'],
  ['أبجدياً', 'Alphabetical', 'ئەلفوبێیی'],
  ['حلقات الموسم', 'Season episodes', 'ئەڵقەکانی وەرز'],
  ['حلقة', 'Episode', 'ئەڵقە'],
  ['مشاهدة مباشرة', 'Watch now', 'ئێستا سەیری بکە'],
  ['تشغيل', 'Play', 'پەخشکردن'],
  ['▶ مشاهدة', '▶ Watch', '▶ بینین'],
  ['تعذّر تحميل المحتوى', 'Could not load content', 'بارکردنی ناوەڕۆک سەرکەوتوو نەبوو'],
  ['حدث خطأ أثناء جلب البيانات، حاول مرة أخرى.', 'There was a problem loading the data. Please try again.', 'کێشەیەک لە بارکردنی داتا ڕوویدا؛ تکایە دووبارە هەوڵ بدەرەوە.'],
  ['تعذّر جلب فهرس الترجمات', 'Could not load the subtitle index', 'نەتوانرا فهرستی ژێرنووسەکان بار بکرێت'],
  ['فهرس الترجمات غير صالح', 'Invalid subtitle index', 'فهرستی ژێرنووسەکان نادروستە'],
  ['معرّف الترجمة غير مكتمل', 'Incomplete subtitle ID', 'ناسنامەی ژێرنووس تەواو نییە'],
  ['تعذّر جلب ملف الترجمة', 'Could not load subtitle file', 'نەتوانرا فایلی ژێرنووس بار بکرێت'],
  ['هذه الترجمة غير متوفرة', 'This subtitle is unavailable', 'ئەم ژێرنووسە بەردەست نییە'],
  ['لا توجد ترجمات متاحة لهذا الفيلم.', 'No subtitles are available for this movie.', 'هیچ ژێرنووسێک بۆ ئەم فیلمە بەردەست نییە.'],
  ['مشغّل', 'Player', 'پەخشکەر'],
  ['الفيديو', 'video', 'ڤیدیۆ'],
  ['التصنيفات', 'Categories', 'پۆلەکان'],
  ['متوسط التقييم', 'Average rating', 'ناوەندی هەڵسەنگاندن'],
  ['التقييم', 'Rating', 'هەڵسەنگاندن'],
  ['تحميل المزيد', 'Load more', 'زیاتر بار بکە'],
  ['الترجمات', 'Subtitles', 'ژێرنووسەکان'],
  ['نوع المحتوى', 'Content type', 'جۆری ناوەڕۆک'],
  ['الترتيب حسب', 'Sort by', 'ڕیزکردن بەپێی'],
  ['تصفية', 'Filter', 'فلتەر'],
  ['الكل', 'All', 'هەموو'],
  ['لا توجد نتائج تطابق هذا البحث.', 'No results match this search.', 'هیچ ئەنجامێک لەگەڵ ئەم گەڕانەدا ناگونجێت.'],
  ['نتائج البحث', 'Search results', 'ئەنجامەکانی گەڕان'],
  ['عرض الكل', 'View all', 'بینینی هەموو'],
  ['إسبانيا', 'Spain', 'ئیسپانیا'],
  ['بريطانيا', 'United Kingdom', 'بەریتانیا'],
  ['اليابان', 'Japan', 'ژاپۆن'],
  ['كوريا الجنوبية', 'South Korea', 'کۆریای باشوور'],
  ['تركيا', 'Turkey', 'تورکیا'],
  ['الولايات المتحدة', 'United States', 'ویلایەتە یەکگرتووەکان'],
  ['الصين', 'China', 'چین']
];

const translations = Object.fromEntries(
  Object.keys(LANGUAGES).map((language) => [
    language,
    new Map(entries.map((entry) => [entry[0], entry[language === 'ckb' ? 2 : 1]]))
  ])
);

let currentLanguage = 'ar';
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let observer = null;

export function translateText(text, language = currentLanguage) {
  if (language === 'ar' || !translations[language]) return text;
  const trimmed = text.trim();
  const translated = translations[language].get(trimmed);
  if (translated) return text.replace(trimmed, translated);

  const patterns = [
    [/^الموسم (\d+) — الحلقة (\d+)$/, (m) => language === 'en' ? `Season ${m[1]} — Episode ${m[2]}` : `وەرزی ${m[1]} — ئەڵقەی ${m[2]}`],
    [/^الموسم (\d+)$/, (m) => language === 'en' ? `Season ${m[1]}` : `وەرزی ${m[1]}`],
    [/^الحلقة (\d+)$/, (m) => language === 'en' ? `Episode ${m[1]}` : `ئەڵقەی ${m[1]}`],
    [/^عرض (\d+) من (\d+) عنوان$/, (m) => language === 'en' ? `Showing ${m[1]} of ${m[2]} titles` : `پیشاندانی ${m[1]} لە ${m[2]} ناونیشان`],
    [/^عرض (\d+) من (\d+) عنوان \(الترتيب حسب/, (m) => language === 'en' ? `Showing ${m[1]} of ${m[2]} titles (sorted by` : `پیشاندانی ${m[1]} لە ${m[2]} ناونیشان (ڕیزکردن بە`],
    [/^تم عرض (\d+) من (\d+) نتيجة \(صفحة (\d+)(.*)\)$/, (m) => language === 'en' ? `Showing ${m[1]} of ${m[2]} results (page ${m[3]}${m[4]})` : `پیشاندانی ${m[1]} لە ${m[2]} ئەنجام (پەڕەی ${m[3]}${m[4]})`],
    [/^تم عرض (\d+) نتيجة$/, (m) => language === 'en' ? `Showing ${m[1]} results` : `پیشاندانی ${m[1]} ئەنجام`],
    [/^(\d+) تقييم$/, (m) => language === 'en' ? `${m[1]} ratings` : `${m[1]} هەڵسەنگاندن`],
    [/^(\d+) تقييمات$/, (m) => language === 'en' ? `${m[1]} ratings` : `${m[1]} هەڵسەنگاندن`],
    [/^التقييم ([\d.]+) من 10$/, (m) => language === 'en' ? `Rated ${m[1]} out of 10` : `هەڵسەنگاندن ${m[1]} لە 10`],
    [/^([+-]?\d+(?:\.\d+)?) ث$/, (m) => language === 'en' ? `${m[1]} sec` : `${m[1]} چرکە`],
    [/^لا توجد نتائج تطابق «(.+)»( في المسلسلات| في الأفلام)?\.$/, (m) => language === 'en' ? `No results match “${m[1]}”${m[2] === ' في المسلسلات' ? ' in TV shows' : m[2] ? ' in movies' : ''}.` : `هیچ ئەنجامێک لەگەڵ «${m[1]}»${m[2] === ' في المسلسلات' ? ' لە زنجیرەکاندا' : m[2] ? ' لە فیلمەکاندا' : ''} ناگونجێت.`],
    [/^حلقة (\d+)$/, (m) => language === 'en' ? `Episode ${m[1]}` : `ئەڵقەی ${m[1]}`],
    [/^تعذّر جلب فهرس الترجمات \((\d+)\)$/, (m) => language === 'en' ? `Could not load the subtitle index (${m[1]})` : `نەتوانرا فهرستی ژێرنووسەکان بار بکرێت (${m[1]})`],
    [/^تعذّر جلب ملف الترجمة \((\d+)\)$/, (m) => language === 'en' ? `Could not load subtitle file (${m[1]})` : `نەتوانرا فایلی ژێرنووس بار بکرێت (${m[1]})`],
    [/^تعذّر تحميل ملف الترجمة$/, () => language === 'en' ? 'Could not load subtitle file' : 'نەتوانرا فایلی ژێرنووس بار بکرێت'],
    [/^تعذّر الاتصال بالخادم \((\d+)\)$/, (m) => language === 'en' ? `Could not connect to the server (${m[1]})` : `نەتوانرا پەیوەندی بە ڕاژەکارەوە بکرێت (${m[1]})`]
  ];
  for (const [pattern, render] of patterns) {
    const match = pattern.exec(trimmed);
    if (match) return text.replace(trimmed, render(match));
  }
  const watchTitle = /^(.+?)(?: \(م (\d+) ح (\d+)\))? — مشاهدة — hwto\.kurd$/.exec(trimmed);
  if (watchTitle) {
    const episode = watchTitle[2]
      ? language === 'en' ? ` (S${watchTitle[2]} E${watchTitle[3]})` : ` (و${watchTitle[2]} ئە${watchTitle[3]})`
      : '';
    const label = language === 'en' ? 'Watch' : 'بینین';
    return text.replace(trimmed, `${watchTitle[1]}${episode} — ${label} — hwto.kurd`);
  }
  const title = /^(.+) — hwto\.kurd$/.exec(trimmed);
  if (title) {
    let heading = title[1];
    heading = heading.replace(/: أفلام$/, language === 'en' ? ': Movies' : ': فیلمەکان');
    heading = heading.replace(/: مسلسلات$/, language === 'en' ? ': TV series' : ': زنجیرە');
    const colon = /^(.+): (Movies|TV series|فیلمەکان|زنجیرە)$/.exec(heading);
    if (colon) {
      const section = translateText(colon[1], language);
      const suffix = language === 'en' ? colon[2] : colon[2] === 'Movies' || colon[2] === 'فیلمەکان' ? 'فیلمەکان' : 'زنجیرە';
      if (section !== colon[1]) return text.replace(trimmed, `${section}: ${suffix} — hwto.kurd`);
    }
    heading = translateText(heading, language);
    if (heading !== title[1]) return text.replace(trimmed, `${heading} — hwto.kurd`);
  }
  const seasons = /^المواسم والأجزاء \((\d+)\)$/.exec(trimmed);
  if (seasons) {
    const label = language === 'en' ? `Seasons (${seasons[1]})` : `وەرزەکان (${seasons[1]})`;
    return text.replace(trimmed, label);
  }
  const count = /^عرض (.+) من (.+) عنوان$/.exec(trimmed);
  if (count) {
    const label = language === 'en' ? `Showing ${count[1]} of ${count[2]} titles` : `پیشاندانی ${count[1]} لە ${count[2]} ناونیشان`;
    return text.replace(trimmed, label);
  }
  return text;
}

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, textarea, input, select, option, .subtitle-cue, .card-title, .hero-title, .hero-overview, .detail-title, .detail-original, .overview-text')) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const source = originalText.get(node);
    const result = translateText(source);
    if (node.nodeValue !== result) node.nodeValue = result;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    if (!node.hasAttribute(attribute)) continue;
    let saved = originalAttributes.get(node);
    if (!saved) {
      saved = new Map();
      originalAttributes.set(node, saved);
    }
    if (!saved.has(attribute)) saved.set(attribute, node.getAttribute(attribute));
    const source = saved.get(attribute);
    const result = translateText(source);
    if (node.getAttribute(attribute) !== result) node.setAttribute(attribute, result);
  }
  for (const child of node.childNodes) translateNode(child);
}

function applyLanguage(language) {
  currentLanguage = LANGUAGES[language] ? language : 'ar';
  const { dir } = LANGUAGES[currentLanguage];
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = dir;
  const picker = document.getElementById('language-switcher');
  if (picker && picker.value !== currentLanguage) picker.value = currentLanguage;
  translateNode(document.documentElement);
}

export function initLocalization() {
  let saved = 'ar';
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES[value]) saved = value;
  } catch {
    // Storage may be unavailable; the language picker still works for this visit.
  }

  const picker = document.getElementById('language-switcher');
  if (picker) {
    picker.addEventListener('change', () => {
      const language = LANGUAGES[picker.value] ? picker.value : 'ar';
      try {
        localStorage.setItem(LANGUAGE_KEY, language);
      } catch {
        // Keep the selected language active for this visit.
      }
      applyLanguage(language);
    });
  }

  applyLanguage(saved);
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateNode(mutation.target);
      else if (mutation.type === 'attributes') translateNode(mutation.target);
      else for (const node of mutation.addedNodes) translateNode(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'placeholder', 'title']
  });
}
