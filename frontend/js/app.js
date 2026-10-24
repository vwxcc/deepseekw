/* AI CH — SPA (vanilla JS) */
(() => {
  'use strict';

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let workspaceUploadIntent = false;
  let pendingNewChatProjectId = '';
  let pendingNewChatProjectLabel = '';
  let addChatProjects = [];
  let addChatActiveView = 'main';
  let addChatSelectedFileIds = new Set();
  // Keep execution controls scoped to explicitly marked file-generation blocks.
  const actionCarouselTimers = new WeakMap();

  function bindActionCarouselAutoplay(root = document) {
    $$('.aich-ui-actions-carousel', root).forEach(carousel => {
      if (actionCarouselTimers.has(carousel)) return;
      const advance = () => {
        if (!carousel.isConnected) {
          const timer = actionCarouselTimers.get(carousel);
          if (timer) { clearTimeout(timer.first); clearInterval(timer.interval); }
          actionCarouselTimers.delete(carousel);
          return;
        }
        if (carousel.matches(':hover') || carousel.contains(document.activeElement)) return;
        const cards = $$('.aich-ui-action', carousel);
        if (cards.length < 2 || carousel.scrollWidth <= carousel.clientWidth + 4) return;
        const style = getComputedStyle(carousel);
        const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
        const step = Math.max(1, cards[0].getBoundingClientRect().width + gap);
        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        const next = carousel.scrollLeft + step;
        carousel.scrollTo({ left: next >= max - 4 ? 0 : next, behavior: 'smooth' });
      };
      const timer = { first: null, interval: null };
      timer.first = window.setTimeout(() => {
        advance();
        if (carousel.isConnected) timer.interval = window.setInterval(advance, 2000);
      }, 500);
      actionCarouselTimers.set(carousel, timer);
    });
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // inline SVG icon from the sprite in index.html
  function icon(id, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  }

  // Map common text emojis to minimalist neutral SVG line art.
  const THEMED_EMOJI_ITEMS = [["✅","check-circle","Готово"],["✔️","check-circle","Готово"],["☑️","check-circle","Отмечено"],["❌","x","Ошибка"],["✖️","x","Закрыть"],["⚠️","alert","Внимание"],["⚠","alert","Внимание"],["❗","alert","Важно"],["❓","question","Вопрос"],["ℹ️","info","Информация"],["💡","lightbulb","Идея"],["🧠","brain","Мышление"],["🎯","target","Цель"],["📌","bookmark","Закрепить"],["📍","map-pin","Метка"],["📎","paperclip","Вложение"],["📝","pencil","Заметка"],["✏️","pencil","Редактировать"],["📄","file-text","Документ"],["📃","file-text","Документ"],["📑","book","Закладки"],["📚","book-open","Книги"],["📖","book-open","Читать"],["🔖","bookmark","Закладка"],["📁","folder","Папка"],["📂","folder-open","Открытая папка"],["💾","save","Сохранить"],["📦","package","Пакет"],["📤","upload","Загрузить"],["📥","download","Скачать"],["🖼️","image","Изображение"],["🎨","palette","Палитра"],["🖌️","brush","Кисть"],["📊","chart","Диаграмма"],["📈","chart-line","Рост"],["📉","chart-line","Снижение"],["🧮","calculator","Расчёт"],["💻","terminal","Компьютер"],["🖥️","terminal","Монитор"],["⌨️","table","Клавиатура"],["🖱️","target","Мышь"],["📱","phone","Телефон"],["🔋","gauge","Батарея"],["🔌","settings","Питание"],["⚙️","settings","Настройки"],["🛠️","wrench","Инструменты"],["🔧","wrench","Инструмент"],["🧰","package","Набор инструментов"],["🧪","flask","Эксперимент"],["🔬","microscope","Исследование"],["🧬","network","ДНК"],["🧫","flask","Образец"],["🧹","x","Очистка"],["🧯","shield-check","Безопасность"],["🚀","rocket","Запуск"],["✈️","arrow-right","Самолёт"],["🚗","package","Машина"],["🚲","compass","Велосипед"],["🏠","folder","Дом"],["🏢","package","Здание"],["🌍","globe","Мир"],["🌐","globe-box","Сеть"],["🔗","link","Ссылка"],["🔒","lock","Защита"],["🔓","unlock","Открыть доступ"],["🛡️","shield-check","Защита"],["🔑","lock","Ключ"],["👤","user","Пользователь"],["👥","users","Люди"],["🧑","user","Человек"],["🧑‍💻","code","Разработка"],["🤖","robot","Робот"],["💬","chat","Сообщение"],["🗣️","chat","Обсуждение"],["✉️","mail","Письмо"],["📣","megaphone","Объявление"],["🔔","bell","Уведомление"],["🔕","bell-off","Без звука"],["⭐","star","Избранное"],["🌟","star","Звезда"],["❤️","heart","Нравится"],["💚","heart","Нравится"],["🔥","fire","Огонь"],["⚡","zap","Молния"],["💎","diamond","Ценность"],["🏆","trophy","Победа"],["🎉","party","Праздник"],["🎁","gift-open","Подарок"],["🎓","graduation-cap","Обучение"],["🏅","medal","Медаль"],["⏳","hourglass","Ожидание"],["⏰","clock","Будильник"],["🕒","clock","Время"],["⏱️","clock","Таймер"],["📅","calendar","Календарь"],["➡️","arrow-right","Далее"],["⬆️","arrow-up","Вверх"],["↗️","arrow-up-right","Переход"],["🔄","refresh","Обновить"],["🔃","refresh","Повтор"],["➕","plus","Добавить"],["➖","x","Убрать"],["🧩","puzzle","Часть"],["🪄","wand","Магия"],["👀","eye","Просмотр"],["👍","thumb-up","Нравится"],["👎","thumb-down","Не нравится"],["🙌","users","Ура"],["💪","target","Сила"],["🙏","user","Пожалуйста"],["😊","smile","Радость"],["😎","smile-cool","Круто"],["🚫","x","Запрет"],["🗺️","map","Карта"],["🧵","link","Нить"],["🔀","refresh","Перемешать"],["🔁","refresh","Повторить"],["📡","network","Сигнал"],["🕸️","network","Связи"],["🧱","package","Блоки"],["📋","copy","Буфер"],["🛒","package","Корзина"],["💰","gauge","Деньги"],["🪙","gauge","Монета"],["💵","gauge","Купюра"],["☁️","globe","Облако"],["☀️","sparkle","Солнце"],["🌙","sparkle","Луна"],["🍃","sparkle","Лист"],["🌱","sparkle","Росток"],["🎵","audio","Музыка"],["🎬","image","Видео"],["🎮","puzzle","Игра"],["☕","sparkle","Кофе"],["🍎","sparkle","Яблоко"],["🍕","package","Пицца"],["🌈","palette","Радуга"],["💧","sparkle","Вода"],["🐱","sparkle","Кот"],["🐶","sparkle","Собака"],["🐾","sparkle","Следы"],["🤝","users","Сотрудничество"],["🏁","bookmark","Финиш"],["🌻","sparkle","Цветок"],["🌳","package","Дерево"],["🍰","gift-open","Торт"],["🪫","gauge","Низкий заряд"],["🛟","shield-check","Помощь"],["⚖️","calculator","Баланс"],["♻️","refresh","Переработка"],["🫶","heart","Поддержка"]];
  const THEMED_EMOJI_MAP = new Map();
  THEMED_EMOJI_ITEMS.forEach(([glyph, symbol, label]) => {
    const item = { symbol, label };
    THEMED_EMOJI_MAP.set(glyph, item);
    const plain = glyph.replace(/\uFE0F/g, '');
    if (plain !== glyph) THEMED_EMOJI_MAP.set(plain, item);
  });

  // Broader emoji coverage for the assistant's most common expressive symbols.
  // Every entry resolves to the same calm, monochrome AI-Ch outline sprite.
  const THEMED_EMOJI_EXTRA_ITEMS = [
    ["😀","smile","Радость"],["😃","smile","Радость"],["😄","smile","Радость"],["😁","smile","Улыбка"],
    ["😆","smile","Смех"],["😅","smile","Смех"],["🤣","smile","Смех"],["😂","smile","Смех"],
    ["🙂","smile","Улыбка"],["🙃","smile","Ирония"],["😉","smile-cool","Подмигивание"],["😊","smile","Радость"],
    ["😇","smile","Доброта"],["🥰","heart","Тепло"],["😍","heart","Восхищение"],["🤩","star","Восторг"],
    ["😘","heart","Поцелуй"],["😗","smile","Улыбка"],["😚","heart","Поцелуй"],["😙","smile","Улыбка"],
    ["🥲","smile","Тронут"],["😋","smile","Вкусно"],["😛","smile","Шутка"],["😜","smile-cool","Шутка"],
    ["🤪","smile-cool","Игривость"],["😝","smile","Шутка"],["🤑","wallet","Деньги"],["🤗","heart-hands","Поддержка"],
    ["🤭","smile","Смущение"],["🫢","smile","Удивление"],["🫣","eye","Подглядывание"],["🤫","user","Тишина"],
    ["🤔","brain","Размышление"],["🫡","check-circle","Принято"],["🤐","user","Молчание"],["🤨","eye","Сомнение"],
    ["😐","smile","Нейтрально"],["😑","smile","Без эмоций"],["😶","user","Молчание"],["🫥","eye","Незаметность"],
    ["😏","smile-cool","Уверенность"],["😒","smile","Недовольство"],["🙄","eye","Скепсис"],["😬","smile","Неловкость"],
    ["😮","smile","Удивление"],["😯","smile","Удивление"],["😲","smile","Изумление"],["😳","smile","Смущение"],
    ["🥺","heart","Просьба"],["🥹","heart","Тронут"],["😦","smile","Удивление"],["😧","alert","Тревога"],
    ["😨","alert","Страх"],["😰","alert","Тревога"],["😥","smile","Облегчение"],["😢","smile","Грусть"],
    ["😭","smile","Слёзы"],["😱","alert","Испуг"],["😖","smile","Огорчение"],["😣","smile","Напряжение"],
    ["😞","smile","Разочарование"],["😓","smile","Усталость"],["😩","smile","Усталость"],["😫","smile","Усталость"],
    ["🥱","smile","Сонливость"],["😤","zap","Решимость"],["😡","alert","Злость"],["😠","alert","Недовольство"],
    ["🤬","alert","Злость"],["🤯","brain","Потрясение"],["😈","smile-cool","Озорство"],["👿","alert","Недовольство"],
    ["💀","alert","Череп"],["☠️","alert","Опасность"],["💩","sparkle","Символ"],["🤡","smile","Клоун"],
    ["👻","sparkle","Призрак"],["👽","robot","Инопланетянин"],["👾","gamepad","Игра"],["🤖","robot","Робот"],
    ["😺","cat","Кот"],["😸","cat","Кот"],["😹","cat","Кот"],["😻","cat","Кот"],["😼","cat","Кот"],
    ["😽","cat","Кот"],["🙀","cat","Кот"],["😿","cat","Кот"],["😾","cat","Кот"],
    ["🙋","user","Вопрос"],["🙋‍♂️","user","Вопрос"],["🙋‍♀️","user","Вопрос"],["🙆","users","Согласие"],
    ["🙅","ban","Отказ"],["🙇","user","Поклон"],["🤦","user","Разочарование"],["🤷","users","Не знаю"],
    ["🙍","user","Недовольство"],["🙎","user","Недовольство"],["🙌","hands","Ура"],["👏","hands","Аплодисменты"],
    ["🤝","handshake","Сотрудничество"],["🫶","heart-hands","Поддержка"],["💋","heart","Поцелуй"],
    ["💯","check-circle","Сто процентов"],["💢","alert","Раздражение"],["💫","sparkle","Звёзды"],
    ["💤","moon","Сон"],["💭","chat","Мысль"],["🗯️","chat","Реплика"],["💬","chat","Сообщение"],
    ["🩷","heart","Сердце"],["🩵","heart","Сердце"],["🩶","heart","Сердце"],["🤍","heart","Сердце"],
    ["🖤","heart","Сердце"],["💜","heart","Сердце"],["💙","heart","Сердце"],["💛","heart","Сердце"],
    ["🧡","heart","Сердце"],["💔","heart","Разбитое сердце"],["❤️‍🔥","heart","Сильные чувства"],
    ["❤️‍🩹","heart","Поддержка"],["💞","heart","Сердца"],["💕","heart","Сердца"],["💖","heart","Сердце"],
    ["💗","heart","Сердце"],["💘","heart","Сердце"],["💝","gift-open","Подарок"],["💌","mail","Письмо"],
    ["🌦️","cloud","Погода"],["🌧️","cloud","Дождь"],["⛈️","cloud","Гроза"],["🌩️","cloud","Гроза"],
    ["🌨️","cloud","Снег"],["🌥️","cloud","Облачно"],["🌤️","sun","Прояснение"],["🌪️","cloud","Ветер"],
    ["🌫️","cloud","Туман"],["🌬️","cloud","Ветер"],["❄️","sparkle","Снег"],["☃️","sparkle","Снеговик"],
    ["⛄","sparkle","Снеговик"],["🌊","droplet","Волна"],["🌋","mountain","Вулкан"],["🏔️","mountain","Горы"],
    ["⛰️","mountain","Горы"],["🌄","sun","Рассвет"],["🌅","sun","Закат"],["🌇","sun","Закат"],
    ["🌆","building","Город"],["🌃","moon","Ночь"],["🌌","sparkle","Космос"],["🪐","sparkle","Планета"],
    ["🌵","sprout","Кактус"],["🪴","sprout","Растение"],["🍀","leaf","Удача"],["☘️","leaf","Клевер"],
    ["🪷","flower","Цветок"],["🌾","sprout","Колос"],["🪻","flower","Цветок"],["🪹","tree","Гнездо"],
    ["🪺","tree","Гнездо"],["🪵","tree","Дерево"],["🌴","tree","Пальма"],["🌲","tree","Ель"],
    ["🌷","flower","Цветок"],["🌼","flower","Цветок"],["🌸","flower","Цветок"],["💐","flower","Букет"],
    ["🥀","flower","Цветок"],["🍂","leaf","Листопад"],["🍁","leaf","Клён"],["🌿","leaf","Зелень"],
    ["🥑","apple","Авокадо"],["🍓","apple","Ягода"],["🍇","apple","Виноград"],["🍉","apple","Арбуз"],
    ["🍌","apple","Банан"],["🍍","apple","Ананас"],["🥭","apple","Манго"],["🍑","apple","Персик"],
    ["🍒","apple","Вишня"],["🫐","apple","Ягоды"],["🥝","apple","Киви"],["🍋","apple","Лимон"],
    ["🍐","apple","Груша"],["🍊","apple","Апельсин"],["🥥","apple","Кокос"],["🥕","sprout","Морковь"],
    ["🌽","sprout","Кукуруза"],["🥦","leaf","Овощи"],["🥬","leaf","Зелень"],["🧄","sprout","Чеснок"],
    ["🧅","sprout","Лук"],["🥔","package","Картофель"],["🍠","package","Батат"],["🥐","package","Выпечка"],
    ["🥯","package","Выпечка"],["🍞","package","Хлеб"],["🥖","package","Багет"],["🥨","package","Крендель"],
    ["🧀","package","Сыр"],["🥚","package","Яйцо"],["🍳","package","Еда"],["🥞","package","Блины"],
    ["🧇","package","Вафли"],["🥓","package","Еда"],["🥩","package","Еда"],["🍗","package","Еда"],
    ["🍖","package","Еда"],["🌭","package","Еда"],["🍔","package","Еда"],["🥪","package","Еда"],
    ["🌮","package","Еда"],["🌯","package","Еда"],["🫔","package","Еда"],["🥙","package","Еда"],
    ["🧆","package","Еда"],["🥗","leaf","Салат"],["🥘","package","Еда"],["🫕","package","Еда"],
    ["🥫","package","Консервы"],["🍝","package","Паста"],["🍜","package","Суп"],["🍲","package","Еда"],
    ["🍛","package","Еда"],["🍣","package","Еда"],["🍱","package","Еда"],["🥟","package","Еда"],
    ["🫓","package","Лепёшка"],["🍤","package","Еда"],["🍙","package","Еда"],["🍚","package","Еда"],
    ["🍘","package","Еда"],["🍥","package","Еда"],["🥠","package","Еда"],["🥮","package","Еда"],
    ["🍢","package","Еда"],["🍡","package","Еда"],["🍧","package","Десерт"],["🍨","package","Десерт"],
    ["🍦","package","Десерт"],["🧁","cake","Десерт"],["🍪","cake","Десерт"],["🍩","cake","Десерт"],
    ["🍫","cake","Шоколад"],["🍬","cake","Конфета"],["🍭","cake","Леденец"],["🍮","cake","Десерт"],
    ["🍯","package","Мёд"],["🥛","coffee","Молоко"],["🍼","coffee","Напиток"],["🫖","coffee","Чайник"],
    ["🍵","coffee","Чай"],["🧋","coffee","Напиток"],["🥤","coffee","Напиток"],["🧃","coffee","Сок"],
    ["🍺","coffee","Напиток"],["🍻","coffee","Напиток"],["🥂","coffee","Тост"],["🍷","coffee","Напиток"],
    ["🍸","coffee","Коктейль"],["🍹","coffee","Напиток"],["🧉","coffee","Напиток"],["🥢","package","Палочки"],
    ["🥄","package","Ложка"],["🍴","package","Приборы"],["🔪","wrench","Нож"],["⚽","target","Спорт"],
    ["🏀","target","Спорт"],["🏈","target","Спорт"],["⚾","target","Спорт"],["🥎","target","Спорт"],
    ["🎾","target","Спорт"],["🏐","target","Спорт"],["🏉","target","Спорт"],["🥏","target","Спорт"],
    ["🎱","target","Бильярд"],["🏓","target","Спорт"],["🏸","target","Спорт"],["🥍","target","Спорт"],
    ["🥅","target","Ворота"],["🏒","target","Спорт"],["🏑","target","Спорт"],["🥊","arm-flex","Бокс"],
    ["🥋","arm-flex","Единоборства"],["🥇","medal","Медаль"],["🥈","medal","Медаль"],["🥉","medal","Медаль"],
    ["🎖️","medal","Медаль"],["🏵️","medal","Медаль"],["🏋️","arm-flex","Тренировка"],["🤸","users","Гимнастика"],
    ["🤼","users","Спорт"],["🤽","users","Спорт"],["🤾","users","Спорт"],["🚴","bicycle","Велоспорт"],
    ["🏃","user","Бег"],["🚶","user","Ходьба"],["🧘","user","Медитация"],["🏄","user","Сёрфинг"],
    ["🏊","user","Плавание"],["⛷️","user","Лыжи"],["🏂","user","Сноуборд"],["🛹","bicycle","Скейтборд"],
    ["🛼","bicycle","Ролики"],["🎯","target","Цель"],["🎳","target","Боулинг"],["🎮","gamepad","Игра"],
    ["🕹️","gamepad","Игра"],["🎲","puzzle","Кости"],["♟️","puzzle","Шахматы"],["🧩","puzzle","Головоломка"],
    ["🎸","music","Музыка"],["🎹","music","Музыка"],["🥁","music","Музыка"],["🎷","music","Музыка"],
    ["🎺","music","Музыка"],["🪇","music","Музыка"],["🎻","music","Музыка"],["🎧","audio","Наушники"],
    ["🎤","audio","Микрофон"],["🎼","music","Ноты"],["🎵","music","Музыка"],["🎶","music","Музыка"],
    ["📸","image","Фото"],["📷","image","Фотоаппарат"],["📹","film","Видео"],["🎥","film","Кино"],
    ["🎞️","film","Киноплёнка"],["📽️","film","Проектор"],["🎙️","audio","Микрофон"],["🛰️","globe","Спутник"],
    ["🛜","network","Сеть"],["📶","network","Сигнал"],["🛜","network","Сеть"],["🔍","search","Поиск"],
    ["🔎","search","Поиск"],["🪛","wrench","Отвёртка"],["🔩","wrench","Болт"],["🪚","wrench","Пила"],
    ["🪓","wrench","Топор"],["🪜","ruler","Лестница"],["🪝","link","Крюк"],["🧲","wrench","Магнит"],
    ["🧻","file-text","Бумага"],["🪒","wrench","Инструмент"],["🪥","wrench","Щётка"],["🧴","package","Флакон"],
    ["🧷","paperclip","Булавка"],["🪡","pencil","Игла"],["🧵","thread","Нить"],["🪢","link","Узел"],
    ["📸","image","Фото"],["🛗","building","Лифт"],["🪞","image","Зеркало"],["🪟","building","Окно"],
    ["🛏️","home","Кровать"],["🪑","home","Стул"],["🧳","package","Чемодан"],["🛍️","package","Покупки"],
    ["🧸","gift-open","Игрушка"],["🪅","party","Праздник"],["🪩","sparkle","Диско"],["🪇","music","Музыка"],
    ["🧿","eye","Оберег"],["🪬","shield-check","Защита"],["🪄","wand","Магия"],["🧯","fire-extinguisher","Огнетушитель"],
    ["🧑‍⚕️","user","Медицина"],["🧑‍🎓","graduation-cap","Учёба"],["🧑‍🏫","graduation-cap","Преподавание"],
    ["🧑‍🚀","rocket","Космонавт"],["🧑‍🍳","package","Повар"],["🧑‍🔬","microscope","Исследователь"],
    ["🧑‍🎨","palette","Художник"],["🧑‍🔧","wrench","Механик"],["🧑‍💼","user","Работа"],
    ["🧑‍⚖️","scale","Судья"],["🧑‍🌾","sprout","Фермер"],["🧑‍🚒","fire-extinguisher","Пожарный"],
    ["🧑‍✈️","plane","Пилот"],["🧑‍🦽","user","Человек"],["🧑‍🦯","user","Человек"],["🧑‍🦼","user","Человек"],
    ["👨‍👩‍👧‍👦","users","Семья"],["👩‍👩‍👧‍👧","users","Семья"],["👨‍👨‍👦‍👦","users","Семья"],
    ["🧑‍🤝‍🧑","users","Люди"],["👫","users","Люди"],["👭","users","Люди"],["👬","users","Люди"],
    ["💃","users","Танец"],["🕺","users","Танец"],["🫂","heart-hands","Поддержка"],
    ["🌍","globe","Мир"],["🌎","globe","Мир"],["🌏","globe","Мир"],["🌐","globe-box","Сеть"],
    ["🏳️","flag","Флаг"],["🏴","flag","Флаг"],["🏁","flag","Финиш"],["🚩","flag","Флаг"],["🎌","flag","Флаги"],
    ["🏳️‍🌈","flag","Равенство"],["🏳️‍⚧️","flag","Равенство"],
    ["🛸","rocket","Космос"],["🚁","plane","Вертолёт"],["🚂","car","Транспорт"],["🚆","car","Транспорт"],
    ["🚇","car","Транспорт"],["🚈","car","Транспорт"],["🚉","car","Станция"],["🚊","car","Транспорт"],
    ["🚝","car","Транспорт"],["🚄","car","Транспорт"],["🚅","car","Транспорт"],["🚗","car","Машина"],
    ["🚕","car","Такси"],["🚙","car","Машина"],["🚌","car","Автобус"],["🚎","car","Транспорт"],
    ["🏎️","car","Гоночная машина"],["🚓","car","Транспорт"],["🚑","car","Скорая помощь"],["🚒","car","Пожарная машина"],
    ["🚐","car","Транспорт"],["🚚","car","Грузовик"],["🚜","car","Трактор"],["🛵","bicycle","Скутер"],
    ["🛴","bicycle","Самокат"],["🛶","bicycle","Лодка"],["⛵","bicycle","Парусник"],["🚤","bicycle","Катер"],
    ["🛥️","bicycle","Катер"],["🚢","bicycle","Корабль"],["✈️","plane","Самолёт"],["🛫","plane","Вылет"],
    ["🛬","plane","Прилёт"],["🪂","plane","Парашют"],["🚀","rocket","Ракета"],["🛣️","map","Дорога"],
    ["🛤️","map","Железная дорога"],["🗽","building","Памятник"],["🗼","building","Башня"],["🏰","building","Замок"],
    ["🏯","building","Замок"],["🏟️","building","Стадион"],["🎡","building","Аттракцион"],["🎢","building","Аттракцион"],
    ["🎠","building","Карусель"],["⛲","droplet","Фонтан"],["⛺","home","Палатка"],["🏕️","home","Лагерь"],
    ["🗻","mountain","Гора"],["🏖️","sun","Пляж"],["🏝️","tree","Остров"],["🏜️","sun","Пустыня"],
    ["🧭","compass","Компас"],["🗺️","map","Карта"],["🧳","package","Чемодан"],
    ["🛡️","shield-check","Защита"],["🔐","lock","Защита"],["🔏","lock","Защита"],["🗝️","key","Ключ"],
    ["🔑","key","Ключ"],["🧑‍💻","code","Разработка"],["💻","terminal","Компьютер"],["🖥️","terminal","Монитор"],
    ["⌚","clock","Часы"],["⏲️","timer","Таймер"],["⏰","clock","Будильник"],["📡","network","Антенна"],
    ["🔋","battery","Батарея"],["🪫","battery-low","Разряд"],["🔌","plug","Питание"],["📺","film","Телевизор"],
    ["📻","audio","Радио"],["📟","phone","Пейджер"],["☎️","phone","Телефон"],["📞","phone","Телефон"],
    ["📬","mail","Почта"],["📮","mail","Почта"],["📦","package","Посылка"],["🗃️","database","Архив"],
    ["🗂️","folder","Папки"],["🗄️","database","Шкаф"],["🧾","file-text","Чек"],["🗒️","file-text","Заметка"],
    ["🗓️","calendar","Календарь"],["📇","users","Контакты"],["📰","file-text","Новости"],["🗞️","file-text","Газета"],
    ["📜","file-text","Документ"],["📜","file-text","Документ"],["🪧","info","Табличка"],["🪪","user","Документ"],
    ["🧮","calculator","Расчёт"],["📏","ruler","Линейка"],["📐","ruler","Угольник"],["🖇️","paperclip","Скрепки"],
    ["📍","map-pin","Метка"],["🧷","paperclip","Булавка"],["📛","alert","Идентификатор"],["🔖","bookmark","Закладка"],
    ["📚","book-open","Книги"],["📓","book","Тетрадь"],["📔","book","Тетрадь"],["📕","book","Книга"],
    ["📗","book","Книга"],["📘","book","Книга"],["📙","book","Книга"],["📒","book","Блокнот"],
    ["✉️","mail","Письмо"],["📨","mail","Письмо"],["📩","mail","Письмо"],["📫","mail","Почта"],
    ["💼","package","Работа"],["📌","bookmark","Закрепить"],["📎","paperclip","Вложение"],["📝","pencil","Заметка"],
    ["✏️","pencil","Редактировать"],["🖊️","pencil","Письмо"],["🖋️","pencil","Письмо"],["🖌️","brush","Кисть"],
    ["🖍️","palette","Мелок"],["📃","file-text","Документ"],["📄","file-text","Документ"],["🗑️","trash","Корзина"],
    ["🧹","broom","Уборка"],["🪣","package","Ведро"],["🧺","package","Корзина"],["🧼","package","Мыло"],
    ["🧽","package","Губка"],["🧯","fire-extinguisher","Безопасность"],["🚿","droplet","Душ"],["🛁","droplet","Ванна"],
    ["🚽","home","Ванная"],["🧴","package","Флакон"],["🧪","flask","Эксперимент"],["🔬","microscope","Исследование"],
    ["🧬","dna","ДНК"],["🩺","heart","Медицина"],["💊","package","Медицина"],["🩹","package","Первая помощь"],
    ["🩼","user","Опора"],["🩻","file-text","Снимок"],["🧫","flask","Образец"],["🧹","broom","Уборка"]
  ];
  THEMED_EMOJI_EXTRA_ITEMS.forEach(([glyph, symbol, label]) => {
    const item = { symbol, label };
    THEMED_EMOJI_MAP.set(glyph, item);
    const plain = glyph.replace(/\uFE0F/g, '');
    if (plain !== glyph) THEMED_EMOJI_MAP.set(plain, item);
  });

  // Unicode fallback ensures newly added emoji, skin tones, families and flags
  // are also replaced by neutral outline symbols instead of colorful system glyphs.
  const EMOJI_SEQUENCE_SOURCE = String.raw`(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Emoji_Presentation}\uFE0F?(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}\uFE0F?(?:[\u{1F3FB}-\u{1F3FF}])?)*|\p{Extended_Pictographic}\uFE0F(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}\uFE0F?(?:[\u{1F3FB}-\u{1F3FF}])?)*)`;
  const escapeEmojiRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const knownEmojiPattern = Array.from(THEMED_EMOJI_MAP.keys())
    .sort((a, b) => b.length - a.length)
    .map(escapeEmojiRegex).join('|');
  const THEMED_EMOJI_PATTERN = new RegExp('(?:' + knownEmojiPattern + ')|' + EMOJI_SEQUENCE_SOURCE, 'gu');

  function themedEmojiItem(glyph) {
    const plain = glyph.replace(/\uFE0F/g, '');
    const known = THEMED_EMOJI_MAP.get(glyph) || THEMED_EMOJI_MAP.get(plain);
    if (known) return known;

    const keycap = glyph.match(/^([#*0-9])\uFE0F?\u20E3$/u);
    if (keycap) return { symbol: null, label: 'Символ ' + keycap[1], keycap: keycap[1] };

    const firstBase = Array.from(glyph).find(char =>
      char !== '\uFE0E' && char !== '\uFE0F' && char !== '\u200D' &&
      !/[\u{1F3FB}-\u{1F3FF}]/u.test(char) &&
      !/[\u{E0020}-\u{E007F}]/u.test(char)
    ) || glyph;
    const cp = firstBase.codePointAt(0);
    if (/\p{Regional_Indicator}/u.test(glyph) || cp === 0x1F3F4) return { symbol: 'flag', label: 'Флаг' };
    if ((cp >= 0x1F600 && cp <= 0x1F64F) || (cp >= 0x1F910 && cp <= 0x1F92F)) {
      return { symbol: 'smile', label: 'Эмоция' };
    }
    if ((cp >= 0x1F466 && cp <= 0x1F487) || (cp >= 0x1F574 && cp <= 0x1F596) ||
        (cp >= 0x1F9D1 && cp <= 0x1F9DD) || (cp >= 0x1FAC3 && cp <= 0x1FAC5)) {
      return { symbol: 'user', label: 'Человек' };
    }
    if ((cp >= 0x1F400 && cp <= 0x1F43F) || (cp >= 0x1F980 && cp <= 0x1F9AE) ||
        (cp >= 0x1F577 && cp <= 0x1F579)) return { symbol: 'paw', label: 'Животное' };
    if ((cp >= 0x1F330 && cp <= 0x1F343) || (cp >= 0x1F344 && cp <= 0x1F34F)) {
      return { symbol: 'leaf', label: 'Природа' };
    }
    if ((cp >= 0x1F3A0 && cp <= 0x1F3BF)) return { symbol: 'party', label: 'Развлечение' };
    if ((cp >= 0x1F3C0 && cp <= 0x1F3F0)) return { symbol: 'trophy', label: 'Спорт' };
    if ((cp >= 0x1F680 && cp <= 0x1F6FF)) return { symbol: 'car', label: 'Транспорт' };
    if ((cp >= 0x1F950 && cp <= 0x1F96F) || (cp >= 0x1F9C0 && cp <= 0x1F9C2) ||
        (cp >= 0x1FAD0 && cp <= 0x1FADF) || (cp >= 0x1F32D && cp <= 0x1F37F)) {
      return { symbol: 'package', label: 'Предмет' };
    }
    if ((cp >= 0x1F4A0 && cp <= 0x1F4FF) || (cp >= 0x1FA70 && cp <= 0x1FAFF)) {
      return { symbol: 'package', label: 'Предмет' };
    }
    if (cp >= 0x2600 && cp <= 0x27BF) return { symbol: 'sparkle', label: 'Символ' };
    return { symbol: 'sparkle', label: 'Символ' };
  }

  function themedEmojiSvg(glyph, item) {
    if (item.keycap) {
      const label = escapeHtml(item.keycap);
      return '<svg class="ic aich-themed-emoji-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="2.8" y="2.8" width="18.4" height="18.4" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
        '<text x="12" y="16" fill="currentColor" font-size="10.5" text-anchor="middle" font-family="inherit">' + label + '</text></svg>';
    }
    return '<svg class="ic aich-themed-emoji-icon" aria-hidden="true"><use href="#i-' + item.symbol + '"></use></svg>';
  }
  function renderThemedEmojis(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('code,pre,script,style,textarea,svg,.katex,.aich-themed-emoji')) continue;
      THEMED_EMOJI_PATTERN.lastIndex = 0;
      if (THEMED_EMOJI_PATTERN.test(node.nodeValue || '')) nodes.push(node);
      THEMED_EMOJI_PATTERN.lastIndex = 0;
    }
    nodes.forEach(textNode => {
      const value = textNode.nodeValue || '';
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      value.replace(new RegExp(THEMED_EMOJI_PATTERN.source, 'gu'), (glyph, offset) => {
        if (offset > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, offset)));
        const item = themedEmojiItem(glyph);
        if (!item) fragment.appendChild(document.createTextNode(glyph));
        else {
          const span = document.createElement('span');
          span.className = 'aich-themed-emoji';
          span.setAttribute('role', 'img');
          span.setAttribute('aria-label', item.label);
          span.title = item.label;
          span.innerHTML = themedEmojiSvg(glyph, item);
          fragment.appendChild(span);
        }
        cursor = offset + glyph.length;
        return glyph;
      });
      if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
      textNode.replaceWith(fragment);
    });
  }
  function chatOriginBannerHtml() {
    const chat = (state.chats || []).find(item => item && item.id === state.currentChatId);
    if (!chat || !chat.source_chat_id || state.readonly) return '';
    return '<aside class="chat-origin-banner" aria-label="Источник ветки">' +
      '<span class="chat-origin-icon" aria-hidden="true">' + icon('git-branch') + '</span>' +
      '<span class="chat-origin-copy"><small>Ветка создана из чата</small><strong>' +
      escapeHtml(String(chat.source_chat_title || 'Исходный чат')) + '</strong></span>' +
      '<button type="button" class="chat-origin-link" data-ui-action="open-origin-chat" data-ui-value="' +
      escapeHtml(String(chat.source_chat_id)) + '">Открыть исходный чат ' + icon('arrow-right') + '</button></aside>';
  }

  function formatSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1024 / 1024).toFixed(1) + ' МБ';
  }
  function timeAgo(iso) {
    const d = new Date(iso + (iso && !iso.endsWith('Z') ? 'Z' : ''));
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    if (s < 604800) return Math.floor(s / 86400) + ' дн назад';
    return d.toLocaleDateString('ru-RU');
  }

  // Clipboard that also works over plain http:// (not a secure context)
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function toast(message, kind) {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, 3400);
  }

  function copyableAnswerText(value) {
    let text = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    const fence = String.fromCharCode(96).repeat(3);
    text = text.replace(new RegExp(fence + '[ \\t]*(?:draw|aich-ui|ui|svg)(?:[ \\t][^\\n]*)?\\n[\\s\\S]*?' + fence, 'gi'), '');
    text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, '');
    text = text.replace(/<picture\b[^>]*>[\s\S]*?<\/picture\s*>/gi, '');
    text = text.replace(/<img\b[^>]*\/?>/gi, '');
    text = text.replace(/!\[([^\]]*)\]\(\s*[^)]+\)/g, '$1');
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  async function copyWithFeedback(btn, text, okLabel) {
    const ok = await copyText(text);
    if (btn && btn.hasAttribute('data-icon-only')) {
      if (ok) {
        btn.classList.add('copied');
        toast('Скопировано');
        setTimeout(() => btn.classList.remove('copied'), 1100);
      } else {
        toast('Не удалось скопировать', 'error');
      }
      return;
    }
    const original = btn.textContent;
    btn.textContent = ok ? (okLabel || 'Скопировано') : 'Не удалось';
    if (!ok) toast('Не удалось скопировать', 'error');
    setTimeout(() => { btn.textContent = original; }, 1300);
  }

  // ---------- markdown ----------
  const FULL_RENDER_LIMIT = 60000;
  let _mathStore = [];
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;

  function inlineFmt(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // restore raw math last so markdown does not mangle it
    s = s.replace(/\u0001M(\d+)\u0001/g, (m, i) => _mathStore[+i] || '');
    return s;
  }

  function renderMath(root) {
    if (!root || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
      });
    } catch (e) { /* katex optional */ }
  }

  function tailText(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? '…' + s.slice(-n) : s;
  }

  // --- drawing skill: ```draw {json} -> inline SVG ---
  function shapeSvg(s) {
    if (!s || !s.type) return '';
    const a = [];
    const push = (k, v) => { if (v !== undefined && v !== null && v !== '') a.push(k + '="' + v + '"'); };
    const common = () => {
      push('fill', s.fill);
      push('stroke', s.stroke);
      push('stroke-width', s.width);
      push('opacity', s.opacity);
      if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
      if (s.rotate) push('transform', 'rotate(' + s.rotate + ' ' + (s.cx || s.x || 0) + ' ' + (s.cy || s.y || 0) + ')');
    };
    const pts = (list) => (Array.isArray(list) ? list : []).filter(p => Array.isArray(p) && p.length >= 2).map(p => (p[0] || 0) + ',' + (p[1] || 0)).join(' ');
    switch (String(s.type)) {
      case 'rect':
        push('x', s.x || 0); push('y', s.y || 0);
        push('width', s.w || 0); push('height', s.h || 0);
        if (s.rx) push('rx', s.rx);
        if (s.fill == null && s.stroke == null) push('fill', '#4b4a46');
        common();
        return '<rect ' + a.join(' ') + '/>';
      case 'circle':
        push('cx', s.cx || 0); push('cy', s.cy || 0); push('r', s.r || 0);
        if (s.fill == null) push('fill', '#4b4a46');
        common();
        return '<circle ' + a.join(' ') + '/>';
      case 'ellipse':
        push('cx', s.cx || 0); push('cy', s.cy || 0);
        push('rx', s.rx || 0); push('ry', s.ry || 0);
        if (s.fill == null) push('fill', '#4b4a46');
        common();
        return '<ellipse ' + a.join(' ') + '/>';
      case 'line':
        push('x1', s.x1 || 0); push('y1', s.y1 || 0);
        push('x2', s.x2 || 0); push('y2', s.y2 || 0);
        push('stroke', s.stroke || '#1f1e1d');
        push('stroke-width', s.width || 2);
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        push('opacity', s.opacity);
        return '<line ' + a.join(' ') + '/>';
      case 'arrow':
        return arrowSvg(s);
      case 'arc': {
        const cx = s.cx || 0, cy = s.cy || 0, r = s.r || 0;
        const a0 = (Number(s.start) || 0) * Math.PI / 180;
        const a1 = (Number(s.end) || 180) * Math.PI / 180;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = Math.abs((Number(s.end) || 0) - (Number(s.start) || 0)) > 180 ? 1 : 0;
        push('d', 'M ' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' +
          large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2));
        push('fill', s.fill || 'none');
        push('stroke', s.stroke || '#4b4a46');
        push('stroke-width', s.width || 2);
        push('opacity', s.opacity);
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        return '<path ' + a.join(' ') + '/>';
      }
      case 'star': {
        const cx = s.cx || 0, cy = s.cy || 0, R = s.r || 20;
        const n = Math.max(3, Math.min(24, Number(s.points) || 5));
        const r2 = R * 0.45;
        const out = [];
        for (let k = 0; k < n * 2; k++) {
          const ang = (Math.PI / n) * k - Math.PI / 2;
          const rad = k % 2 === 0 ? R : r2;
          out.push([(cx + rad * Math.cos(ang)).toFixed(2), (cy + rad * Math.sin(ang)).toFixed(2)]);
        }
        push('points', out.map(p => p[0] + ',' + p[1]).join(' '));
        if (s.fill == null) push('fill', '#f2c14e');
        common();
        return '<polygon ' + a.join(' ') + '/>';
      }
      case 'dim': {
        // blueprint dimension line: extension ticks + arrows + centred label
        const x1 = Number(s.x1) || 0, y1 = Number(s.y1) || 0;
        const x2 = Number(s.x2) || 0, y2 = Number(s.y2) || 0;
        const stroke = s.stroke || '#1f1e1d';
        const w = s.width || 1.4;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const tick = 6;
        const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
        const t1 = vertical
          ? '<line x1="' + (x1 - tick) + '" y1="' + y1 + '" x2="' + (x1 + tick) + '" y2="' + y1 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>'
          : '<line x1="' + x1 + '" y1="' + (y1 - tick) + '" x2="' + x1 + '" y2="' + (y1 + tick) + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
        const t2 = vertical
          ? '<line x1="' + (x2 - tick) + '" y1="' + y2 + '" x2="' + (x2 + tick) + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>'
          : '<line x1="' + x2 + '" y1="' + (y2 - tick) + '" x2="' + x2 + '" y2="' + (y2 + tick) + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
        return '<g>' + t1 + t2 +
          arrowSvg({ x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, width: w, both: true }) +
          (s.text ? '<text x="' + mx + '" y="' + (my - 6) + '" font-size="' + (s.size || 12) +
            '" fill="' + stroke + '" text-anchor="middle">' + escapeHtml(s.text) + '</text>' : '') +
          '</g>';
      }
      case 'polyline':
      case 'polygon': {
        push('points', pts(s.points));
        if (String(s.type) === 'polygon') {
          if (s.fill == null) push('fill', '#4b4a46');
        } else {
          push('fill', 'none');
          push('stroke', s.stroke || '#4b4a46');
          push('stroke-width', s.width || 2);
        }
        common();
        return '<' + s.type + ' ' + a.join(' ') + '/>';
      }
      case 'path':
        push('d', s.d || '');
        push('fill', s.fill || 'none');
        push('stroke', s.stroke || '#4b4a46');
        push('stroke-width', s.width || 2);
        push('opacity', s.opacity);
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        return '<path ' + a.join(' ') + '/>';
      case 'text':
        push('x', s.x || 0); push('y', s.y || 0);
        push('font-size', s.size || 16);
        push('fill', s.fill || '#1f1e1d');
        push('opacity', s.opacity);
        if (s.anchor) push('text-anchor', s.anchor);
        if (s.weight) push('font-weight', s.weight);
        if (s.rotate) push('transform', 'rotate(' + s.rotate + ' ' + (s.x || 0) + ' ' + (s.y || 0) + ')');
        return '<text ' + a.join(' ') + '>' + escapeHtml(s.text || '') + '</text>';
      default:
        return '';
    }
  }

  function arrowSvg(s) {
    const x1 = Number(s.x1) || 0, y1 = Number(s.y1) || 0;
    let x2 = Number(s.x2) || 0, y2 = Number(s.y2) || 0;
    const stroke = s.stroke || '#2f6fb0';
    const w = Number(s.width) || 2;
    const head = Math.max(6, w * 3.2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const tipX = x2, tipY = y2;
    const bx = x2 - head * Math.cos(ang), by = y2 - head * Math.sin(ang);
    const spread = 0.42;
    const p1x = bx + (head * 0.55) * Math.cos(ang + Math.PI / 2 + spread);
    const p1y = by + (head * 0.55) * Math.sin(ang + Math.PI / 2 + spread);
    const p2x = bx + (head * 0.55) * Math.cos(ang - Math.PI / 2 - spread);
    const p2y = by + (head * 0.55) * Math.sin(ang - Math.PI / 2 - spread);
    const line = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + bx.toFixed(2) + '" y2="' + by.toFixed(2) +
      '" stroke="' + stroke + '" stroke-width="' + w + '"' +
      (s.dash ? ' stroke-dasharray="' + (typeof s.dash === 'number' ? s.dash + ' ' + s.dash : s.dash) + '"' : '') +
      (s.opacity != null ? ' opacity="' + s.opacity + '"' : '') + '/>';
    const headEl = '<polygon points="' + tipX + ',' + tipY + ' ' + p1x.toFixed(2) + ',' + p1y.toFixed(2) +
      ' ' + p2x.toFixed(2) + ',' + p2y.toFixed(2) + '" fill="' + stroke + '"/>';
    if (!s.both) return '<g>' + line + headEl + '</g>';
    const ang2 = ang + Math.PI;
    const bx2 = x1 + head * Math.cos(ang2), by2 = y1 + head * Math.sin(ang2);
    const forward = ang;
    const q1x = bx2 + (head * 0.55) * Math.cos(forward + Math.PI / 2 + spread);
    const q1y = by2 + (head * 0.55) * Math.sin(forward + Math.PI / 2 + spread);
    const q2x = bx2 + (head * 0.55) * Math.cos(forward - Math.PI / 2 - spread);
    const q2y = by2 + (head * 0.55) * Math.sin(forward - Math.PI / 2 - spread);
    const headEl2 = '<polygon points="' + x1 + ',' + y1 + ' ' + q1x.toFixed(2) + ',' + q1y.toFixed(2) +
      ' ' + q2x.toFixed(2) + ',' + q2y.toFixed(2) + '" fill="' + stroke + '"/>';
    return '<g>' + line + headEl + headEl2 + '</g>';
  }

  function drawBlockHtml(code) {
    let spec;
    try { spec = JSON.parse(code); } catch (e) { return codeBlockHtml('draw', code); }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return codeBlockHtml('draw', code);
    const w = Number.isFinite(Number(spec.width)) ? Math.max(1, Math.min(2000, Number(spec.width))) : 420;
    const h = Number.isFinite(Number(spec.height)) ? Math.max(1, Math.min(1600, Number(spec.height))) : 300;
    const bg = spec.background == null ? 'transparent' : spec.background;
    const legacyElements = !Array.isArray(spec.shapes) && Array.isArray(spec.elements);
    const sourceShapes = Array.isArray(spec.shapes) ? spec.shapes : (legacyElements ? spec.elements : []);
    const shapes = sourceShapes.map(shape => {
      const item = Object.assign({}, shape || {});
      if (legacyElements && item.type === 'rect') {
        if (item.w == null && item.width != null) item.w = item.width;
        if (item.h == null && item.height != null) item.h = item.height;
        item.width = item.strokeWidth != null ? item.strokeWidth : 1.5;
      } else if (item.type === 'rect') {
        if (item.w == null && item.width != null) item.w = item.width;
        if (item.h == null && item.height != null) item.h = item.height;
      }
      if (item.type === 'text') {
        if (item.size == null && item.fontSize != null) item.size = item.fontSize;
        if (item.anchor == null && item.textAnchor != null) item.anchor = item.textAnchor;
        if (item.weight == null && item.fontWeight != null) item.weight = item.fontWeight;
      }
      if (item.stroke == null) item.stroke = '#77756e';
      if (item.width == null) item.width = 1.5;
      if (item.type === 'text') {
        if (item.fill == null) item.fill = '#66645d';
      } else if (item.fill == null) {
        item.fill = 'none';
      }
      return shapeSvg(item);
    }).join('');
    return shapes
      ? '<div class="draw-block"><svg viewBox="0 0 ' + w + ' ' + h +
        '" width="100%" style="max-width:' + w + 'px;background:' + bg + '">' + shapes + '</svg></div>'
      : '<div class="draw-block draw-block-empty" role="note">Схема не содержит поддерживаемых элементов.</div>';
  }

  function languageLabel(lang) {
    const key = String(lang || '').trim().toLowerCase().split(/\s+/)[0].replace(/^language-/, '');
    const labels = {
      py:'Python', python:'Python', python3:'Python', py3:'Python', pyi:'Python',
      js:'JavaScript', javascript:'JavaScript', mjs:'JavaScript', cjs:'JavaScript',
      ts:'TypeScript', typescript:'TypeScript', tsx:'TypeScript JSX', jsx:'JavaScript JSX',
      html:'HTML', htm:'HTML', xhtml:'XHTML', css:'CSS', scss:'SCSS', sass:'Sass', less:'Less',
      sh:'Shell', bash:'Bash', shell:'Shell', zsh:'Zsh', fish:'Fish', powershell:'PowerShell', ps1:'PowerShell',
      bat:'Windows Batch', batch:'Windows Batch', cmd:'Windows CMD',
      json:'JSON', jsonc:'JSONC', json5:'JSON5', yaml:'YAML', yml:'YAML', toml:'TOML', xml:'XML',
      sql:'SQL', mysql:'MySQL SQL', postgresql:'PostgreSQL SQL', postgres:'PostgreSQL SQL', sqlite:'SQLite SQL',
      java:'Java', kt:'Kotlin', kotlin:'Kotlin', scala:'Scala', groovy:'Groovy',
      c:'C', h:'C Header', cpp:'C++', cxx:'C++', cc:'C++', hpp:'C++ Header',
      cs:'C#', csharp:'C#', go:'Go', golang:'Go', rs:'Rust', rust:'Rust',
      rb:'Ruby', ruby:'Ruby', php:'PHP', swift:'Swift', dart:'Dart', r:'R', julia:'Julia', jl:'Julia',
      lua:'Lua', pl:'Perl', perl:'Perl', ex:'Elixir', exs:'Elixir', elixir:'Elixir', erl:'Erlang',
      hs:'Haskell', haskell:'Haskell', ml:'OCaml', clj:'Clojure',
      dockerfile:'Dockerfile', docker:'Dockerfile', makefile:'Makefile', make:'Makefile',
      diff:'Diff', patch:'Patch', regex:'RegEx', md:'Markdown', markdown:'Markdown',
      tex:'LaTeX', latex:'LaTeX', bib:'BibTeX', graphql:'GraphQL', gql:'GraphQL',
      prisma:'Prisma', vue:'Vue', svelte:'Svelte', astro:'Astro', ipynb:'Jupyter Notebook',
      ini:'INI', conf:'Конфигурация', nginx:'Nginx', terraform:'Terraform', tf:'Terraform',
      proto:'Protocol Buffers', protobuf:'Protocol Buffers', solidity:'Solidity', sol:'Solidity',
      verilog:'Verilog', vhdl:'VHDL', wasm:'WebAssembly', asm:'Assembly',
      draw:'Чертёж / схема', run:'Python · запуск в песочнице', text:'Обычный текст', plaintext:'Обычный текст'
    };
    return labels[key] || (key ? key.toUpperCase() : 'Код без указания языка');
  }

  function codeBlockHtml(lang, code) {
    const id = 'code_' + Math.random().toString(36).slice(2);
    const rawCode = String(code || '');
    const key = String(lang || '').trim().toLowerCase().split(/\s+/)[0].replace(/^language-/, '');
    // Hidden protocol markers let the model request a live HTML preview without
    // exposing implementation commands in the visible code.
    const previewMarker = /^\s*<!--\s*AI_CH_PREVIEW_HTML\s*-->/i.test(rawCode) ||
      /^\s*<!--\s*AI_CH_ACTION:\s*preview-html\s*-->/i.test(rawCode);
    const actionMarker = /^\s*#\s*AI_CH_ACTION:\s*[^\r\n]+/i.test(rawCode);
    const cleanedHtml = rawCode
      .replace(/^\s*<!--\s*AI_CH_PREVIEW_HTML\s*-->\s*/i, '')
      .replace(/^\s*<!--\s*AI_CH_ACTION:\s*preview-html\s*-->\s*/i, '');
    const looksLikeHtmlDocument = /^\s*(?:<!doctype\s+html\b|<html(?:\s|>)|<(?:head|body|main|section|article|div|form|header|footer)(?:\s|>))/i.test(cleanedHtml);
    // Some models incorrectly label an HTML page as Python. Detect a document
    // only when the block starts like HTML; preserve Python file-generation code.
    const isHtml = ['html', 'htm', 'xhtml'].includes(key) || previewMarker ||
      (!actionMarker && looksLikeHtmlDocument && ['python', 'py', 'python3', 'run', 'text', 'plaintext', ''].includes(key));
    const displaySource = isHtml ? cleanedHtml : rawCode;
    const looksLikePython = /(^|\n)\s*(?:from\s+[A-Za-z_][\w.]*\s+import\b|import\s+[A-Za-z_]\w*|def\s+\w+\s*\(|class\s+\w+\s*(?:\(|:)|print\s*\(|if\s+__name__\s*==|for\s+\w+\s+in\s+|#\s*AI_CH_ACTION:)/m.test(rawCode);
    const isRunnablePythonBlock = !isHtml && (
      ['python', 'py', 'python3', 'py3', 'run'].includes(key) ||
      (['', 'text', 'plaintext', 'txt'].includes(key) && looksLikePython)
    );
    const displayLang = isHtml ? 'html' : (looksLikePython && ['', 'text', 'plaintext', 'txt'].includes(key) ? 'python' : (lang || ''));
    const isFileGenerationBlock = isRunnablePythonBlock && actionMarker;
    const displayCode = isFileGenerationBlock
      ? displaySource
          .replace(/^\s*#\s*AI_CH_ACTION:\s*[^\r\n]+\s*(?:\r?\n|$)/i, '')
          .replace(/(?:^|\r?\n)\s*#\s*AI_CH_AUTO_RUN_FILES\s*$/i, '')
          .trimEnd()
      : displaySource;
    window.__codeStore = window.__codeStore || {};
    window.__codeStore[id] = { lang: displayLang, code: displayCode };
    const isSvg = key === 'svg' && /<svg(?:\s|>)/i.test(displayCode);
    const svgDocument = isSvg
      ? '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>html,body{margin:0;min-height:100%;background:#fff}body{padding:12px;box-sizing:border-box;display:grid;place-items:center}svg{display:block;max-width:100%;max-height:calc(100vh - 24px);height:auto}</style>' +
        '</head><body>' + displayCode + '</body></html>'
      : '';
    const preview = isHtml
      ? '<div class="html-preview"><div class="hp-bar">' + icon('globe') +
        '<span>Живое превью</span><button type="button" class="preview-run" data-preview-run="' + id +
        '" title="Запустить или обновить HTML-превью">' + icon('play') + '<span>Запустить</span></button></div>' +
        '<iframe sandbox="allow-scripts allow-forms" loading="eager" title="Предпросмотр HTML" srcdoc="' +
        escapeHtml(displayCode) + '"></iframe></div>'
      : isSvg
        ? '<div class="html-preview svg-preview"><div class="hp-bar">' + icon('image') +
          '<span>Предпросмотр SVG</span></div>' +
          '<iframe sandbox="" loading="lazy" title="Предпросмотр SVG" srcdoc="' +
          escapeHtml(svgDocument) + '"></iframe></div>'
        : '';
    const runButton = isRunnablePythonBlock
      ? '<button type="button" class="file-code-run" data-run-device="1" data-run-file-block="' + id +
        '" title="Запустить Python-код в песочнице">' + icon('play') + '<span>Запустить</span></button>'
      : '';
    const lines = displayCode.split('\n');
    const collapsed = lines.length > 5;
    const previewCode = lines.slice(0, 5).join('\n') + (collapsed ? '\n…' : '');
    const toggleButton = collapsed
      ? '<button data-code-toggle="' + id + '" aria-expanded="false" title="Развернуть код">' +
        icon('chevron-down') + '<span>Развернуть</span></button>'
      : '';
    return '<div class="code-block' + (collapsed ? ' is-collapsed' : '') + (isHtml ? ' html-code-block' : '') + '"><div class="code-head"><span>' +
      escapeHtml(languageLabel(displayLang)) + '</span><span class="code-acts">' +
      toggleButton +
      '<button data-copy="' + id + '">' + icon('copy') + 'Копировать</button>' +
      '<button data-dl="' + id + '" title="Скачать">' + icon('download') + '</button>' +
      runButton + '</span></div>' + preview +
      (collapsed
        ? '<pre class="code-preview"><code>' + escapeHtml(previewCode) + '</code></pre>' +
          '<pre class="code-full" hidden><code>' + escapeHtml(displayCode) + '</code></pre>'
        : '<pre class="code-full"><code>' + escapeHtml(displayCode) + '</code></pre>') +
      '</div>';
  }
  function safeHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) { return ''; }
  }

  function imageResultsHtml(sources) {
    const rows = (Array.isArray(sources) ? sources : [])
      .filter(item => item && typeof item === 'object' && item.kind === 'image')
      .map(item => {
        const imageUrl = safeHttpUrl(item.thumbnail_url || item.image_url);
        const sourceUrl = safeHttpUrl(item.url);
        if (!imageUrl) return '';
        const title = String(item.title || 'Изображение из интернета').slice(0, 180);
        let domain = '';
        try { domain = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./i, '') : ''; } catch (e) {}
        const image = '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(title) +
          '" loading="lazy" decoding="async" referrerpolicy="no-referrer" />';
        const media = sourceUrl
          ? '<a class="aich-web-image-media" href="' + escapeHtml(sourceUrl) +
            '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml('Источник изображения: ' + title) + '">' + image + '</a>'
          : '<div class="aich-web-image-media">' + image + '</div>';
        return '<figure class="aich-web-image-card">' + media +
          '<figcaption><span>' + escapeHtml(title) + '</span>' +
          (domain ? '<a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(domain) + '</a>' : '') + '</figcaption></figure>';
      }).filter(Boolean).slice(0, 6);
    if (!rows.length) return '';
    return '<section class="aich-web-images is-collapsed" aria-label="Изображения из интернет-поиска">' +
      '<button type="button" class="aich-web-images-toggle" data-web-images-toggle aria-expanded="false">' +
      icon('image') + '<span>Показать изображения из интернета</span>' + icon('chevron-down') + '</button>' +
      '<div class="aich-web-images-grid">' + rows.join('') + '</div></section>';
  }


  function revokeDeviceChatFileUrl(url) {
    try { URL.revokeObjectURL(url); } catch (e) {}
    const index = deviceChatFileUrls.indexOf(url);
    if (index >= 0) deviceChatFileUrls.splice(index, 1);
    deviceChatFiles.forEach((items, key) => {
      const remaining = items.filter(item => item.url !== url);
      if (remaining.length) deviceChatFiles.set(key, remaining);
      else deviceChatFiles.delete(key);
    });
  }

  function rememberDeviceFileForMessage(messageId, name, blob) {
    const id = String(messageId || '');
    if (!id || !blob) return;
    const safeName = String(name || 'output.bin').replace(/[\\/\\0-\\x1f]/g, '_').slice(0, 180) || 'output.bin';
    const previous = (deviceChatFiles.get(id) || []).find(file => file.name.toLowerCase() === safeName.toLowerCase());
    if (previous) revokeDeviceChatFileUrl(previous.url);
    const url = URL.createObjectURL(blob);
    deviceChatFileUrls.push(url);
    const current = (deviceChatFiles.get(id) || []).filter(file => file.name.toLowerCase() !== safeName.toLowerCase());
    current.push({ name: safeName, mime: blob.type || 'application/octet-stream', size: blob.size || 0, url });
    deviceChatFiles.set(id, current.slice(-12));
    while (deviceChatFileUrls.length > 40) revokeDeviceChatFileUrl(deviceChatFileUrls[0]);
    if (findNode(state.tree, id)) renderMessageInPlace(id);
  }

  function normaliseOutputFilename(value, mime) {
    const rawMime = String(mime || '').toLowerCase().split(';')[0].trim();
    const mimeExtensions = {
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-excel': '.xls',
      'application/pdf': '.pdf', 'image/svg+xml': '.svg', 'image/png': '.png',
      'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
      'text/csv': '.csv', 'application/json': '.json', 'text/markdown': '.md',
      'text/plain': '.txt', 'application/zip': '.zip',
    };
    let raw = String(value || 'output').replace(/\\/g, '/').split('/').pop().trim();
    raw = raw.replace(/\s*\.(ppt|doc|xls)_$/i, (_, ext) => '.' + ({ ppt: 'pptx', doc: 'docx', xls: 'xlsx' }[ext.toLowerCase()]));
    const extensionMatch = raw.match(/(\.[A-Za-z0-9]{1,8})$/);
    let extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    let stem = extension ? raw.slice(0, -extensionMatch[1].length) : raw;
    stem = stem.replace(/^(?:(?:pptx?|docx?|word|xlsx?|excel|pdf|svg|png|csv|json|markdown|md|text|txt)[\s._-]*)+/i, '');
    stem = stem.replace(/^[\s._-]+|[\s._-]+$/g, '');
    stem = stem.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
    if (mimeExtensions[rawMime] && (rawMime.indexOf('officedocument') >= 0 || !extension)) extension = mimeExtensions[rawMime];
    if (!extension) extension = mimeExtensions[rawMime] || '.bin';
    stem = stem.replace(/[.\s_-]+$/g, '').slice(0, 140);
    if (!stem) stem = extension === '.pptx' || extension === '.ppt' ? 'presentation'
      : extension === '.docx' || extension === '.doc' ? 'document'
      : extension === '.xlsx' || extension === '.xls' ? 'spreadsheet' : 'output';
    return stem + extension;
  }

  const deviceFilePersistence = new Map();
  const deviceFilePersistenceErrors = new Map();
  function persistDeviceFileForMessage(messageId, name, blob) {
    const id = String(messageId || '');
    if (!id || !blob || state.readonly || !state.user) return Promise.resolve(false);
    const previous = deviceFilePersistence.get(id) || Promise.resolve(true);
    const task = previous.catch(() => false).then(async () => {
      let uploaded = null;
      try {
        const safeName = normaliseOutputFilename(name, blob.type);
        const form = new FormData();
        form.append('files', blob, safeName);
        const created = await api.postForm('/api/files', form);
        uploaded = Array.isArray(created) ? created.find(file => file && file.id) : null;
        if (!uploaded) throw new Error('Сервер не подтвердил сохранение файла');
        const attached = await api.post('/api/messages/' + encodeURIComponent(id) + '/attachments', { file_ids: [uploaded.id] });
        const message = findNode(state.tree, id);
        if (message && Array.isArray(attached)) {
          const unique = new Map();
          (Array.isArray(message.attachments) ? message.attachments : []).concat(attached).forEach(item => {
            if (item && item.file_id) unique.set(String(item.file_id), item);
          });
          message.attachments = Array.from(unique.values());
          renderMessageInPlace(id);
        }
        state.files = [uploaded].concat((state.files || []).filter(file => file.id !== uploaded.id));
        renderFiles();
        (deviceChatFiles.get(id) || []).slice().forEach(file => {
          if (file.name.toLowerCase() === safeName.toLowerCase()) revokeDeviceChatFileUrl(file.url);
        });
        deviceFilePersistenceErrors.delete(id);
        return true;
      } catch (error) {
        if (uploaded && uploaded.id) {
          try { await api.del('/api/files/' + encodeURIComponent(uploaded.id)); } catch (_) {}
        }
        const detail = String(error && error.message || error || 'Ошибка сохранения').slice(0, 500);
        deviceFilePersistenceErrors.set(id, detail);
        const node = findNode(state.tree, id);
        if (node) node.deviceRunnerError = 'Файл создан на устройстве, но не сохранён на сервере: ' + detail;
        return false;
      }
    });
    deviceFilePersistence.set(id, task);
    task.finally(() => {
      if (deviceFilePersistence.get(id) === task) deviceFilePersistence.delete(id);
    }).catch(() => {});
    return task;
  }

  function outputFileIconHtml(filename) {
    const name = String(filename || '');
    const match = name.match(/\.([a-z0-9]{1,8})$/i);
    const ext = match ? match[1].toLowerCase() : '';
    const kinds = {
      docx: ['DOCX', 'docx'], doc: ['DOC', 'docx'],
      pptx: ['PPTX', 'pptx'], ppt: ['PPT', 'pptx'],
      xlsx: ['XLSX', 'xlsx'], xls: ['XLS', 'xlsx'],
      pdf: ['PDF', 'pdf'], csv: ['CSV', 'xlsx'], tsv: ['TSV', 'xlsx'],
      svg: ['SVG', 'svg'], png: ['PNG', 'image'], jpg: ['JPG', 'image'],
      jpeg: ['JPEG', 'image'], webp: ['WEBP', 'image'],
      html: ['HTML', 'html'], htm: ['HTML', 'html'],
      js: ['JS', 'code'], py: ['PY', 'code'], json: ['JSON', 'code'],
      zip: ['ZIP', 'archive'], md: ['MD', 'text'], txt: ['TXT', 'text']
    };
    const spec = kinds[ext] || [ext ? ext.toUpperCase().slice(0, 5) : 'FILE', 'generic'];
    return '<span class="aich-output-file-icon filetype-' + spec[1] + '" aria-hidden="true">' +
      '<span class="aich-output-file-glyph">' + icon('file') + '</span>' +
      '<small>' + escapeHtml(spec[0]) + '</small></span>';
  }

  function messageFilesHtml(message) {
    if (!message || typeof message !== 'object' || !message.id) return '';
    const serverFiles = [];
    const seen = new Set();
    const addServerFile = file => {
      if (!file || typeof file !== 'object' || typeof file.file_id !== 'string' || !file.file_id) return;
      if (seen.has(file.file_id)) return;
      seen.add(file.file_id);
      serverFiles.push(file);
    };
    (Array.isArray(message.attachments) ? message.attachments : []).forEach(addServerFile);
    (Array.isArray(message.tool_runs) ? message.tool_runs : []).forEach(run => {
      (run && Array.isArray(run.files) ? run.files : []).forEach(addServerFile);
    });
    const serverNames = new Set(serverFiles.map(file => String(file.name || file.original_name || '').toLowerCase()).filter(Boolean));
    const localFiles = (deviceChatFiles.get(String(message.id)) || [])
      .filter(file => !serverNames.has(String(file.name || '').toLowerCase()));
    if (!serverFiles.length && !localFiles.length) return '';
    const serverHtml = serverFiles.map(file => {
      const name = String(file.name || file.original_name || 'Созданный файл').slice(0, 180);
      const url = '/api/files/' + encodeURIComponent(file.file_id) + '/download';
      const mime = String(file.mime_type || file.mime || '').toLowerCase();
      const isSvg = /\.svg$/i.test(name) || mime === 'image/svg+xml' || file.kind === 'svg';
      const image = isSvg || file.kind === 'image' || mime.indexOf('image/') === 0;
      const previewUrl = isSvg
        ? url + '?inline=1'
        : '/api/files/' + encodeURIComponent(file.file_id) + '/thumbnail';
      const visual = image
        ? '<img class="aich-output-file-preview" src="' + previewUrl + '" alt="' + escapeHtml(name) +
          '" loading="lazy" decoding="async" />'
        : outputFileIconHtml(name);
      return '<a class="aich-output-file" href="' + url + '" target="_blank" rel="noopener noreferrer">' +
        visual + '<span class="aich-output-file-copy"><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml(formatSize(file.size || 0)) + ' · сервер</small></span><span class="aich-output-file-download" aria-hidden="true">' +
        icon('download') + '</span></a>';
    }).join('');
    const localHtml = localFiles.map(file => {
      const name = String(file.name || 'Созданный файл').slice(0, 180);
      const image = String(file.mime || '').toLowerCase().indexOf('image/') === 0;
      const visual = image
        ? '<img class="aich-output-file-preview" src="' + escapeHtml(file.url) + '" alt="' + escapeHtml(name) + '" loading="lazy" />'
        : outputFileIconHtml(name);
      return '<a class="aich-output-file" href="' + escapeHtml(file.url) + '" download="' + escapeHtml(name) + '">' +
        visual + '<span class="aich-output-file-copy"><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml(formatSize(file.size || 0)) + ' · устройство</small></span><span class="aich-output-file-download" aria-hidden="true">' +
        icon('download') + '</span></a>';
    }).join('');
    return '<section class="aich-message-files" aria-label="Файлы">' +
      '<div class="aich-message-files-grid">' + serverHtml + localHtml + '</div></section>';
  }

  function interactiveUiBlockHtml(code) {
    let spec;
    try { spec = JSON.parse(code); } catch (e) { return codeBlockHtml('json', code); }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return codeBlockHtml('json', code);
    const cleanText = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
    const emoji = escapeHtml(cleanText(spec.emoji || '✨', 12));
    const title = cleanText(spec.title, 180);
    const body = cleanText(spec.text, 1600);
    const tone = ['info', 'success', 'warning', 'neutral'].includes(spec.tone) ? spec.tone : 'neutral';
    if (spec.type === 'callout') {
      return '<aside class="aich-ui-callout aich-ui-callout-stable tone-' + tone + '" role="note">' +
        '<span class="aich-ui-emoji" aria-hidden="true">' + emoji + '</span>' +
        '<div class="aich-ui-copy">' +
        (title ? '<strong>' + escapeHtml(title) + '</strong>' : '') +
        (body ? '<div>' + escapeHtml(body).replace(/\s*\n\s*/g, ' ') + '</div>' : '') +
        '</div></aside>';
    }
    const actionButton = item => {
      if (!item || typeof item !== 'object') return '';
      const action = ['copy', 'fill', 'open'].includes(item.action) ? item.action : '';
      const label = cleanText(item.label, 120);
      const value = cleanText(item.value, 2000);
      if (!action || !label || !value) return '';
      if (action === 'open' && !safeHttpUrl(value)) return '';
      const glyph = escapeHtml(cleanText(item.emoji || '↗️', 12));
      return '<button type="button" class="aich-ui-action" data-ui-action="' + action +
        '" data-ui-value="' + escapeHtml(value) + '"><span class="aich-ui-action-emoji" aria-hidden="true">' +
        glyph + '</span><span>' + escapeHtml(label) + '</span><span class="aich-ui-action-arrow" aria-hidden="true">↗</span></button>';
    };
    if (spec.type === 'button') {
      const button = actionButton(spec);
      return button ? '<div class="aich-ui-actions">' + button + '</div>' : codeBlockHtml('json', code);
    }
    if (spec.type === 'actions' && Array.isArray(spec.items)) {
      const buttons = spec.items.slice(0, 6).map(actionButton).filter(Boolean);
      const isCarousel = spec.layout === 'carousel' || spec.presentation === 'carousel' || spec.carousel === true;
      const actionsClass = isCarousel ? 'aich-ui-actions aich-ui-actions-carousel' : 'aich-ui-actions';
      const heading = title
        ? '<div class="aich-ui-actions-heading"><span aria-hidden="true">' + emoji + '</span><strong>' + escapeHtml(title) + '</strong></div>'
        : '';
      return buttons.length ? '<section class="aich-ui-actions-wrap" aria-label="' +
        escapeHtml(title || 'Интерактивные действия') + '">' + heading +
        '<div class="' + actionsClass + '" role="group">' + buttons.join('') + '</div></section>'
        : codeBlockHtml('json', code);
    }
    return codeBlockHtml('json', code);
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const codes = [];
    _mathStore = [];
    let text = String(src);
    // models sometimes forget to close a code fence — close it for them,
    // otherwise the whole message turns into one broken block
    if (((text.match(/```/g) || []).length) % 2 === 1) text += '\n```';
    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const i = codes.length;
      codes.push({ lang: (lang || '').trim(), code: code.replace(/\s+$/, '') });
      return '\u0000C' + i + '\u0000';
    });
    // pull math out before markdown mangles it (KaTeX renders it later)
    text = text.replace(MATH_RE, (m) => {
      const i = _mathStore.length;
      _mathStore.push(m);
      return '\u0001M' + i + '\u0001';
    });

    const lines = text.split('\n');
    const out = [];
    let listType = null, para = [], inQuote = false;

    const flushPara = () => { if (para.length) { out.push('<p>' + inlineFmt(para.join(' ')) + '</p>'); para = []; } };
    const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
    const isTableSep = (s) => s.includes('|') && /^[\s:|-]+$/.test(s) && s.includes('-');
    const splitRow = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cm = line.match(/^\u0000C(\d+)\u0000$/);
      if (cm) {
        flushPara(); closeList(); closeQuote();
        const b = codes[+cm[1]];
        const langKey = String(b.lang || '').trim().toLowerCase().split(/\s+/)[0];
        out.push(langKey === 'draw' ? drawBlockHtml(b.code) :
          (['ui', 'aich-ui'].includes(langKey) ? interactiveUiBlockHtml(b.code) : codeBlockHtml(b.lang, b.code)));
        continue;
      }
      if (!line.trim()) { flushPara(); closeList(); closeQuote(); continue; }
      let m;

      // tables: header row followed by a |---| separator row
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushPara(); closeList(); closeQuote();
        const head = splitRow(line);
        const body = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
          body.push(splitRow(lines[j]));
          j++;
        }
        const tid = 'tbl_' + Math.random().toString(36).slice(2);
        window.__tableStore = window.__tableStore || {};
        window.__tableStore[tid] = [head].concat(body);
        out.push('<div class="table-wrap" data-tbl="' + tid + '">' +
          '<button class="tbl-dl" data-dl-table="' + tid + '" title="Скачать таблицу">' +
          icon('download') + '</button>' +
          '<table><thead><tr>' +
          head.map(c => '<th>' + inlineFmt(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          body.map(r => '<tr>' +
            head.map((_, k) => '<td>' + inlineFmt(r[k] || '') + '</td>').join('') +
          '</tr>').join('') +
          '</tbody></table></div>');
        i = j - 1;
        continue;
      }

      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList(); closeQuote();
        const lvl = Math.min(m[1].length, 3);
        out.push('<h' + lvl + '>' + inlineFmt(m[2]) + '</h' + lvl + '>');
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*>\s?(.*)$/))) {
        flushPara(); closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push('<p>' + inlineFmt(m[1]) + '</p>');
        continue;
      }
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        flushPara(); closeQuote();
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
        continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); closeQuote();
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
        continue;
      }
      closeList(); closeQuote();
      para.push(line.trim());
    }
    flushPara(); closeList(); closeQuote();
    return out.join('\n');
  }

  // ---------- api ----------
  const api = {
    csrf() { return window.__csrf || getCookie('chatstudio_csrf') || ''; },
    async req(method, path, body, isForm, timeoutMs) {
      const headers = {};
      if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-CSRF-Token'] = api.csrf();
      const controller = timeoutMs > 0 ? new AbortController() : null;
      let timeoutId = null;
      if (controller) timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(path, {
          method, headers, credentials: 'same-origin',
          body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (res.status === 401) { showAuth(); throw new Error('Сессия истекла. Войдите снова.'); }
        if (res.status === 204) return null;

        const raw = await res.text();
        if (!res.ok) {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* keep raw response */ }
          let detail = parsed && typeof parsed === 'object' ? parsed.detail : null;
          let message = detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : raw.trim();
          if (!message || message === 'null' || message === 'undefined' || message === '{}') {
            message = 'Сервер вернул пустое описание ошибки';
          }
          throw new Error('HTTP ' + res.status + ': ' + message);
        }
        if (!raw.trim()) {
          throw new Error('Сервер вернул пустой ответ на ' + method + ' ' + path + ' (HTTP ' + res.status + ')');
        }
        try {
          return JSON.parse(raw);
        } catch (parseError) {
          throw new Error('Сервер вернул некорректный JSON на ' + method + ' ' + path + ' (HTTP ' + res.status + ')');
        }
      } catch (err) {
        if (controller && err && err.name === 'AbortError') {
          throw new Error('Истекло время ожидания ответа сервера (' + Math.round(timeoutMs / 1000) + ' с)');
        }
        if (err instanceof Error) throw err;
        const message = err == null || err === 'null' || err === 'undefined'
          ? 'Сервер не вернул описание ошибки'
          : String(err);
        throw new Error(message);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    get(p) { return api.req('GET', p); },
    getTimed(p, timeoutMs) { return api.req('GET', p, undefined, false, timeoutMs); },
    post(p, b) { return api.req('POST', p, b === undefined ? {} : b); },
    postTimed(p, b, timeoutMs) { return api.req('POST', p, b === undefined ? {} : b, false, timeoutMs); },
    postForm(p, fd) { return api.req('POST', p, fd, true); },
    patch(p, b) { return api.req('PATCH', p, b); },
    put(p, b) { return api.req('PUT', p, b === undefined ? {} : b); },
    del(p) { return api.req('DELETE', p); },
    delTimed(p, timeoutMs) { return api.req('DELETE', p, undefined, false, timeoutMs); },
  };

  // ---------- state ----------
  const state = {
    user: null,
    identityReady: false,
    chats: [],
    query: '',
    currentChatId: null,
    tree: [],
    choices: {},          // parentKey -> child index
    chatCreating: false,
    chatOpenToken: 0,
    chatListRequestId: 0,
    chatListVersion: 0,
    files: [],
    pendingAttachments: [],
    streaming: false,
    sending: false,
    streamEl: null,
    streamBuf: '',
    streamStarted: false,
    activeAssistantId: null,
    thinkBody: null,
    modelSets: [],
    modelSetId: localStorage.getItem('aich_model_set_id') || '',
    modelPickerOpen: false,
    effort: 'medium',
    usage: null,
    draftTail: null,
    memories: [],
    style: localStorage.getItem('cs_style') || 'auto',
    responseDetail: ['minimum', 'standard', 'max'].includes(localStorage.getItem('aich_response_detail'))
      ? localStorage.getItem('aich_response_detail') : 'standard',
    deepResearch: localStorage.getItem('aich_deep_research') === '1',
    generatingChatId: '',
    readonly: false,
    publicToken: null,
    greetTimer: null,
    audioReady: Object.create(null),
    audioPending: Object.create(null),
    audioStatusRequested: new Set(),
    audioStatusChatId: null,
    audioRequestInFlight: Object.create(null),
    audioBusyMessageId: null,
    audioStatusPollTimer: null,
    audioStatusPollRunning: false,
    audioMessageId: null,
    audioDuration: 0,
    audioErrors: Object.create(null),
    readableText: Object.create(null),
    readableTextStatusRequested: new Set(),
    readableTextChatId: null,
    readableTextRequestInFlight: Object.create(null),
    readableTextStatusPollTimer: null,
    readableTextStatusPollRunning: false,
    greetIdx: Math.floor(Math.random() * 100),
    suggIdx: Math.floor(Math.random() * 50),
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  const deviceSpeechState = {
    messageId: null, text: '', words: [], chunks: [], index: 0,
    token: 0, utterance: null, active: false, playing: false, pending: false,
    priming: false, watchdog: null, rate: 1,
  };
  const DEVICE_SPEECH_CHUNK_SIZE = 20;
  let pendingDeviceSpeechMessageId = null;
  const deviceCodeFileUrls = [];
  const deviceChatFileUrls = [];
  const deviceChatFiles = new Map();
  let deviceCodeMessageId = null;
  let deviceCodeLastError = '';
  let deviceCodeErrorUrl = null;
  const backgroundDeviceRunners = new Map();
  const DEVICE_PYTHON_RUNNER_TEMPLATE = "(async function() {\n  const out = document.getElementById(\"output\");\n  const source = new TextDecoder().decode(Uint8Array.from(atob(\"__BASE64__\"), c => c.charCodeAt(0)));\n  const runMessageId = __MESSAGE_ID__;\n  const backgroundMode = __BACKGROUND__;\n  const append = value => { const line = String(value); out.textContent += line + \"\\n\"; try { parent.postMessage({type:\"device-code-log\", message:line.slice(0,5000), messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {} };\n  const notify = message => { try { parent.postMessage({type:\"device-code-status\", message:String(message), messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {} };\n  // Prefer Python's actual exception/traceback over a minified WASM call stack.\n  const errorText = error => {\n    const message = error && typeof error.message === \"string\" ? error.message.trim() : \"\";\n    if (message && !/^(?:Error|PythonError|JsException)(?::[ ]*)?$/.test(message)) return message.slice(0,50000);\n    const stack = error && typeof error.stack === \"string\" ? error.stack : \"\";\n    if (stack && !/pyodide[.]asm[.]mjs|wasm-function|new_error@/i.test(stack)) return stack.slice(0,50000);\n    return message || \"Среда Python остановила выполнение без подробного сообщения.\";\n  };\n  const supportedFiles = [\".docx\",\".pptx\",\".xlsx\",\".ppt\",\".doc\",\".xls\",\".ppt_\",\".doc_\",\".xls_\",\".ods\",\".odt\",\".odp\",\".pdf\",\".csv\",\".tsv\",\".txt\",\".json\",\".jsonl\",\".html\",\".htm\",\".svg\",\".png\",\".jpg\",\".jpeg\",\".webp\",\".gif\",\".zip\",\".md\",\".xml\",\".rtf\",\".epub\",\".tex\",\".bib\",\".ipynb\",\".yaml\",\".yml\",\".npy\",\".npz\",\".pickle\",\".pkl\"];\n  const snapshotCode = [\n    \"import os, json\",\n    \"def _aich_snapshot_files():\",\n    \"    files = {}\",\n    \"    allowed = set(\" + JSON.stringify(supportedFiles) + \")\",\n    \"    roots = {os.getcwd(), '/tmp', '/work'}\",\n    \"    def walk(root, depth):\",\n    \"        if depth > 3: return\",\n    \"        try: names = os.listdir(root)\",\n    \"        except Exception: return\",\n    \"        for name in names:\",\n    \"            if name.startswith('.') or name in {'__pycache__', 'site-packages', 'node_modules'}: continue\",\n    \"            path = os.path.join(root, name)\",\n    \"            try:\",\n    \"                if os.path.isdir(path): walk(path, depth + 1)\",\n    \"                elif os.path.isfile(path) and os.path.splitext(name)[1].lower() in allowed:\",\n    \"                    st = os.stat(path); files[path] = [st.st_size, st.st_mtime]\",\n    \"            except Exception: pass\",\n    \"    for root in roots: walk(root, 0)\",\n    \"    return json.dumps(files)\",\n    \"_aich_snapshot_files()\"\n  ].join(\"\\n\");\n  function sourceImports() {\n    const found = new Set();\n    for (const line of source.split(/\\r?\\n/)) {\n      const value = line.trim();\n      if (!value || value.startsWith(\"#\")) continue;\n      const imported = value.match(/^import\\s+(.+?)(?:\\s+#.*)?$/);\n      if (imported) {\n        for (const item of imported[1].split(\",\")) {\n          const name = item.trim().split(/\\s+as\\s+/)[0].split(\".\")[0];\n          if (/^[A-Za-z_]\\w*$/.test(name)) found.add(name);\n        }\n        continue;\n      }\n      const fromImport = value.match(/^from\\s+([\\w.]+)\\s+import\\b/);\n      if (fromImport) {\n        const name = fromImport[1].split(\".\")[0];\n        if (/^[A-Za-z_]\\w*$/.test(name)) found.add(name);\n      }\n    }\n    return [...found];\n  }\n  const nativePackages = {\n    \"PIL\":\"Pillow\",\"numpy\":\"numpy\",\"pandas\":\"pandas\",\"matplotlib\":\"matplotlib\",\"scipy\":\"scipy\",\n    \"sympy\":\"sympy\",\"networkx\":\"networkx\",\"yaml\":\"PyYAML\",\"bs4\":\"beautifulsoup4\",\n    \"dateutil\":\"python-dateutil\",\"lxml\":\"lxml\",\"cv2\":\"opencv-python\",\"sklearn\":\"scikit-learn\",\n    \"skimage\":\"scikit-image\",\"regex\":\"regex\",\"pydantic\":\"pydantic\",\"jsonschema\":\"jsonschema\",\n    \"pygments\":\"Pygments\",\"requests\":\"requests\",\"tqdm\":\"tqdm\",\"pytz\":\"pytz\",\n    \"altair\":\"altair\",\"bokeh\":\"bokeh\",\"statsmodels\":\"statsmodels\",\"pyarrow\":\"pyarrow\",\n    \"polars\":\"polars\",\"xarray\":\"xarray\",\"pytest\":\"pytest\",\"svgwrite\":\"svgwrite\",\n    \"sqlalchemy\":\"sqlalchemy\",\"igraph\":\"igraph\",\"nltk\":\"nltk\",\"imageio\":\"imageio\",\n    \"h5py\":\"h5py\",\"orjson\":\"orjson\",\"packaging\":\"packaging\",\"httpx\":\"httpx\",\n    \"aiohttp\":\"aiohttp\",\"jedi\":\"jedi\",\"IPython\":\"ipython\",\"lightgbm\":\"lightgbm\",\n    \"gmpy2\":\"gmpy2\",\"pyclipper\":\"pyclipper\",\"shapely\":\"shapely\",\"geopandas\":\"geopandas\",\n    \"soundfile\":\"soundfile\",\"sentencepiece\":\"sentencepiece\",\"pyodide_http\":\"pyodide-http\",\n    \"bottleneck\":\"Bottleneck\",\"igraph\":\"igraph\",\"ruamel\":\"ruamel.yaml\",\n    \"cryptography\":\"cryptography\",\"nacl\":\"pynacl\",\"Crypto\":\"pycryptodome\",\n    \"ujson\":\"ujson\",\"xxhash\":\"xxhash\",\"wcwidth\":\"wcwidth\",\"PIL.Image\":\"Pillow\",\n    \"rich\":\"rich\",\"xgboost\":\"xgboost\",\"xlrd\":\"xlrd\",\"wordcloud\":\"wordcloud\",\n    \"brotli\":\"brotli\",\"protobuf\":\"protobuf\",\"fontTools\":\"fonttools\",\"tiktoken\":\"tiktoken\",\n    \"tzdata\":\"tzdata\",\"simplejson\":\"simplejson\",\"pymongo\":\"pymongo\",\"pyclipper\":\"pyclipper\"\n  };\n  const pipPackages = {\n    \"docx\":\"python-docx\",\"pptx\":\"python-pptx\",\"openpyxl\":\"openpyxl\",\"pypdf\":\"pypdf\",\n    \"PyPDF2\":\"PyPDF2\",\"xlsxwriter\":\"XlsxWriter\",\"markdown\":\"Markdown\",\"odf\":\"odfpy\",\n    \"fpdf\":\"fpdf2\",\"docxtpl\":\"docxtpl\",\"jinja2\":\"Jinja2\",\"svgwrite\":\"svgwrite\",\n    \"markdown2\":\"markdown2\",\"tabulate\":\"tabulate\",\"qrcode\":\"qrcode\",\n    \"tinycss2\":\"tinycss2\",\"cssselect2\":\"cssselect2\",\"et_xmlfile\":\"et_xmlfile\",\n    \"docx2txt\":\"docx2txt\",\"barcode\":\"python-barcode\",\"toml\":\"toml\",\n    \"tomli\":\"tomli\",\"tomli_w\":\"tomli-w\",\"xmltodict\":\"xmltodict\",\n    \"markdown_it\":\"markdown-it-py\",\"mistune\":\"mistune\",\"seaborn\":\"seaborn\",\n    \"more_itertools\":\"more-itertools\",\"colorama\":\"colorama\",\"reportlab\":\"reportlab\",\n    \"dateparser\":\"dateparser\",\"pendulum\":\"pendulum\",\"humanize\":\"humanize\",\n    \"faker\":\"Faker\",\"marshmallow\":\"marshmallow\",\"cattrs\":\"cattrs\",\"dacite\":\"dacite\",\n    \"json5\":\"json5\",\"jsonlines\":\"jsonlines\",\"rapidfuzz\":\"rapidfuzz\",\n    \"fuzzywuzzy\":\"fuzzywuzzy\",\"jellyfish\":\"jellyfish\",\"phonenumbers\":\"phonenumbers\",\n    \"slugify\":\"python-slugify\",\"unidecode\":\"Unidecode\",\"transliterate\":\"transliterate\",\n    \"pint\":\"Pint\",\"babel\":\"Babel\",\"holidays\":\"holidays\",\"attrs\":\"attrs\",\n    \"cachetools\":\"cachetools\",\"click\":\"click\",\"typer\":\"typer\",\"rich\":\"rich\",\n    \"loguru\":\"loguru\",\"structlog\":\"structlog\",\"colorlog\":\"colorlog\",\n    \"dotenv\":\"python-dotenv\",\"yaml\":\"PyYAML\",\"bs4\":\"beautifulsoup4\",\n    \"dateutil\":\"python-dateutil\",\"PIL\":\"Pillow\",\"lxml\":\"lxml\",\n    \"fitz\":\"PyMuPDF\",\"pymupdf\":\"PyMuPDF\",\"docxcompose\":\"docxcompose\",\n    \"pptxgenjs\":\"pptxgenjs\",\"pptx_tools\":\"pptx-tools\",\"numpy_financial\":\"numpy-financial\",\n    \"sympy_plot_backends\":\"sympy-plot-backends\",\"pandas_datareader\":\"pandas-datareader\",\n    \"duckdb\":\"duckdb\",\"duckdb_engine\":\"duckdb-engine\",\"sqlglot\":\"sqlglot\",\n    \"pysam\":\"pysam\",\"biopython\":\"biopython\",\"Bio\":\"biopython\",\n    \"xgboost\":\"xgboost\",\"lightgbm\":\"lightgbm\",\"torch\":\"torch\",\n    \"tensorflow\":\"tensorflow\",\"transformers\":\"transformers\",\"tokenizers\":\"tokenizers\",\n    \"spacy\":\"spacy\",\"gensim\":\"gensim\",\"wordcloud\":\"wordcloud\",\n    \"plotly\":\"plotly\",\"dash\":\"dash\",\"streamlit\":\"streamlit\",\n    \"pydantic_settings\":\"pydantic-settings\",\"sqlmodel\":\"sqlmodel\",\n    \"alembic\":\"alembic\",\"redis\":\"redis\",\"fakeredis\":\"fakeredis\",\n    \"websockets\":\"websockets\",\"requests_mock\":\"requests-mock\",\"responses\":\"responses\",\n    \"pytest_asyncio\":\"pytest-asyncio\",\"hypothesis\":\"hypothesis\",\n    \"pytest_cov\":\"pytest-cov\",\"coverage\":\"coverage\",\"tox\":\"tox\",\n    \"yamlinclude\":\"yaml-include\",\"tomlkit\":\"tomlkit\",\"ruamel\":\"ruamel.yaml\",\n    \"xmltodict\":\"xmltodict\",\"lxml_html_clean\":\"lxml_html_clean\",\n    \"jsonpath_ng\":\"jsonpath-ng\",\"jmespath\":\"jmespath\",\"orjson\":\"orjson\",\n    \"pygments\":\"Pygments\",\"networkx\":\"networkx\",\"pytz\":\"pytz\",\n    \"timezonefinder\":\"timezonefinder\",\"geopy\":\"geopy\",\"folium\":\"folium\",\n    \"rasterio\":\"rasterio\",\"cartopy\":\"Cartopy\",\"fiona\":\"fiona\",\n    \"geopandas\":\"geopandas\",\"shapely\":\"shapely\",\"scipy\":\"scipy\",\n    \"scikit_learn\":\"scikit-learn\",\"sklearn\":\"scikit-learn\",\n    \"opencv\":\"opencv-python\",\"cv2\":\"opencv-python\",\"pyarrow\":\"pyarrow\",\n    \"polars\":\"polars\",\"xarray\":\"xarray\",\"statsmodels\":\"statsmodels\",\n    \"sympy\":\"sympy\",\"networkx\":\"networkx\",\"pydantic\":\"pydantic\",\n    \"jsonschema\":\"jsonschema\",\"requests\":\"requests\",\"httpx\":\"httpx\",\n    \"aiohttp\":\"aiohttp\",\"tqdm\":\"tqdm\",\"regex\":\"regex\",\"pytest\":\"pytest\"\n  };\n  let py;\n  let before = {};\n  try {\n    out.textContent = \"Загружаю Python WebAssembly…\";\n    notify(\"Загружаю Python на устройстве…\");\n    py = await loadPyodide({indexURL:\"https://cdn.jsdelivr.net/pyodide/v314.0.7/full/\"});\n    py.setStdout({batched:append});\n    py.setStderr({batched:value => append(\"STDERR: \" + value)});\n    await py.runPythonAsync(\"import os\" + String.fromCharCode(10) + \"os.makedirs('/work/out', exist_ok=True); os.chdir('/home/pyodide')\");\n    before = JSON.parse(await py.runPythonAsync(snapshotCode));\n    // Validate Python syntax before downloading large packages.\n    try {\n      const syntaxBase64 = btoa(unescape(encodeURIComponent(source)));\n      await py.runPythonAsync(\n        \"import ast, base64\\nast.parse(base64.b64decode('\" + syntaxBase64 + \"').decode('utf-8'), filename='ai_ch_generated_file.py')\",\n        {filename:\"ai_ch_preflight.py\"}\n      );\n    } catch (e) {\n      const detail = errorText(e);\n      append(\"Код не запущен: ошибка синтаксиса Python.\\n\" + detail);\n      notify(\"Код не запущен: проверьте синтаксис Python.\");\n      try { parent.postMessage({type:\"device-code-error\", message:detail, messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n      try { parent.postMessage({type:\"device-code-complete\", success:false, files:0, messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n      return;\n    }\n    // Deliberately do not call py.loadPackagesFromImports(source): explicit loading below avoids duplicate package loads.\n    const imports = sourceImports();\n    out.textContent = \"Автоматически загружаю необходимые библиотеки…\";\n    notify(\"Проверяю импорты. Подходящие пакеты загружаются по необходимости…\");\n    const normalizePackageName = value =>\n      String(value || \"\").trim().toLowerCase().replace(/[-_.]+/g, \"-\");\n    const isPackageLoaded = name => {\n      const wanted = normalizePackageName(name);\n      return Object.keys(py.loadedPackages || {}).some(loaded => normalizePackageName(loaded) === wanted);\n    };\n    const nativeRequested = [...new Set(imports.filter(name => nativePackages[name]).map(name => nativePackages[name]))];\n    const nativeFailed = new Set();\n    for (const packageName of nativeRequested) {\n      if (isPackageLoaded(packageName)) continue;\n      try {\n        notify(\"Подготавливаю встроенный модуль \" + packageName + \"…\");\n        await py.loadPackage(packageName);\n      } catch (e) {\n        if (isPackageLoaded(packageName)) continue;\n        nativeFailed.add(packageName);\n        append(\"⚠ Встроенный модуль недоступен: \" + packageName + \" — \" + String(e && e.message || e));\n      }\n    }\n    const dependencies = [];\n    if (imports.some(name => [\"docx\",\"pptx\",\"docxtpl\",\"docxcompose\"].includes(name))) dependencies.push(\"lxml\");\n    if (imports.some(name => [\"docx\",\"pptx\",\"docxtpl\",\"docxcompose\",\"qrcode\",\"fpdf\",\"PIL\",\"Pillow\"].includes(name))) dependencies.push(\"Pillow\");\n    for (const packageName of [...new Set(dependencies)]) {\n      if (isPackageLoaded(packageName)) continue;\n      try {\n        await py.loadPackage(packageName);\n      } catch (e) {\n        if (!isPackageLoaded(packageName)) {\n          nativeFailed.add(packageName);\n          append(\"⚠ Зависимость документа недоступна: \" + packageName);\n        }\n      }\n    }\n    let stdlib = new Set();\n    try {\n      const list = await py.runPythonAsync(\"import sys, json\" + String.fromCharCode(10) + \"json.dumps(sorted(sys.stdlib_module_names))\");\n      stdlib = new Set(JSON.parse(list));\n    } catch (_) {\n      stdlib = new Set([\"abc\",\"argparse\",\"array\",\"ast\",\"asyncio\",\"base64\",\"binascii\",\"bisect\",\"builtins\",\"calendar\",\"cmath\",\"collections\",\"concurrent\",\"configparser\",\"contextlib\",\"copy\",\"csv\",\"ctypes\",\"dataclasses\",\"datetime\",\"decimal\",\"difflib\",\"email\",\"enum\",\"fnmatch\",\"fractions\",\"functools\",\"glob\",\"gzip\",\"hashlib\",\"heapq\",\"html\",\"http\",\"importlib\",\"inspect\",\"io\",\"itertools\",\"json\",\"logging\",\"math\",\"operator\",\"os\",\"pathlib\",\"pickle\",\"platform\",\"pprint\",\"queue\",\"random\",\"re\",\"secrets\",\"shlex\",\"shutil\",\"signal\",\"socket\",\"sqlite3\",\"statistics\",\"string\",\"struct\",\"subprocess\",\"tempfile\",\"textwrap\",\"threading\",\"time\",\"timeit\",\"traceback\",\"types\",\"typing\",\"unicodedata\",\"unittest\",\"urllib\",\"uuid\",\"warnings\",\"weakref\",\"xml\",\"zipfile\",\"zlib\"]);\n    }\n    const wanted = new Set();\n    for (const name of imports) {\n      if (stdlib.has(name) || nativePackages[name]) continue;\n      wanted.add(pipPackages[name] || name);\n    }\n    // Do not retry a failed binary Pyodide package from PyPI as a different wheel.\n    if (imports.includes(\"openpyxl\")) wanted.add(\"et_xmlfile\");\n    if (imports.includes(\"docxtpl\")) wanted.add(\"Jinja2\");\n    if (wanted.size) {\n      try {\n        if (!isPackageLoaded(\"micropip\")) await py.loadPackage(\"micropip\");\n        const micropip = py.pyimport(\"micropip\");\n        for (const packageName of [...wanted]) {\n          if (isPackageLoaded(packageName)) continue;\n          notify(\"Загружаю библиотеку \" + packageName + \"…\");\n          try {\n            await micropip.install(packageName);\n            append(\"✓ Загружена библиотека: \" + packageName);\n          } catch (e) {\n            append(\"⚠ Не удалось установить \" + packageName + \": \" + String(e && e.message || e) +\n              \". Для некоторых бинарных модулей нужна специальная сборка Pyodide.\");\n          }\n        }\n        micropip.destroy();\n      } catch (e) {\n        append(\"⚠ Менеджер дополнительных пакетов недоступен: \" + String(e && e.message || e));\n      }\n    }\n    append(\"\\n--- Выполнение кода ---\");\n    notify(\"Запускаю Python-код на устройстве…\");\n    let runError = null;\n    try {\n      await py.runPythonAsync(source, {filename:\"ai_ch_generated_file.py\"});\n    } catch (e) {\n      runError = e;\n      append(\"Ошибка выполнения: \" + errorText(e));\n      try { parent.postMessage({type:\"device-code-error\", message:errorText(e), messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n    }\n    let exported = 0;\n    const skippedFiles = [];\n    try {\n      const after = JSON.parse(await py.runPythonAsync(snapshotCode));\n      const candidates = Object.keys(after).filter(path => {\n        const now = after[path], was = before[path];\n        return !was || now[0] !== was[0] || now[1] !== was[1];\n      });\n      const canonicalOutputName = value => {\n        let raw = String(value || \"\").replace(/\\\\/g, \"/\").split(\"/\").pop().trim();\n        raw = raw.replace(/\\s*\\.(ppt|doc|xls)_$/i, (_, ext) => \".\" + ({ppt:\"pptx\",doc:\"docx\",xls:\"xlsx\"}[ext.toLowerCase()]));\n        const match = raw.match(/(\\.[A-Za-z0-9]{1,8})$/);\n        const extension = match ? match[1].toLowerCase() : \"\";\n        let stem = match ? raw.slice(0, -match[1].length) : raw;\n        stem = stem.replace(/^(?:(?:pptx?|docx?|word|xlsx?|excel|pdf|svg|png|csv|json|markdown|md|text|txt)[\\s._-]*)+/i, \"\");\n        stem = stem.replace(/[\\\\/:*?\"<>|\\x00-\\x1f]+/g, \"-\").replace(/\\s+/g, \"-\").replace(/-+/g, \"-\").replace(/[.\\s_-]+$/g, \"\").slice(0, 140);\n        if (!extension || !stem) return \"\";\n        return (stem + extension).toLowerCase();\n      };\n      const outputPriority = path => {\n        const name = path.split(\"/\").pop();\n        const malformed = /\\.(?:ppt|doc|xls)_$/i.test(name) ? 2 : 0;\n        const stem = name.replace(/\\.[^.]+$/, \"\");\n        const prefixed = /^(?:(?:pptx?|docx?|word|xlsx?|excel|pdf|svg|png|csv|json|markdown|md|text|txt)[\\s._-]+)+/i.test(stem) ? 1 : 0;\n        return malformed + prefixed;\n      };\n      const seenOutputNames = new Set();\n      const paths = candidates\n        .sort((a, b) => outputPriority(a) - outputPriority(b) || a.localeCompare(b))\n        .filter(path => {\n          const key = canonicalOutputName(path.split(\"/\").pop());\n          if (!key || !/\\.[a-z0-9]{1,8}$/i.test(key)) return false;\n          if (seenOutputNames.has(key)) return false;\n          seenOutputNames.add(key);\n          return true;\n        })\n        .sort();\n      let totalBytes = 0;\n      const mimeFor = name => {\n        const ext = name.toLowerCase().split(\".\").pop();\n        return ({\n          docx:\"application/vnd.openxmlformats-officedocument.wordprocessingml.document\",\n          pptx:\"application/vnd.openxmlformats-officedocument.presentationml.presentation\",\n          xlsx:\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\",\n          pdf:\"application/pdf\",csv:\"text/csv\",tsv:\"text/tab-separated-values\",txt:\"text/plain\",\n          json:\"application/json\",jsonl:\"application/jsonl\",html:\"text/html\",htm:\"text/html\",\n          svg:\"image/svg+xml\",png:\"image/png\",jpg:\"image/jpeg\",jpeg:\"image/jpeg\",webp:\"image/webp\",\n          gif:\"image/gif\",zip:\"application/zip\",md:\"text/markdown\",xml:\"application/xml\",rtf:\"application/rtf\",\n          epub:\"application/epub+zip\",tex:\"application/x-tex\",bib:\"text/plain\",ipynb:\"application/x-ipynb+json\",\n          yaml:\"text/yaml\",yml:\"text/yaml\",npy:\"application/octet-stream\",npz:\"application/octet-stream\",\n          pickle:\"application/octet-stream\",pkl:\"application/octet-stream\"\n        })[ext] || \"application/octet-stream\";\n      };\n      for (const path of paths) {\n        const name = canonicalOutputName(path.split(\"/\").pop());\n        if (name.startsWith(\".\") || name.endsWith(\".pyc\")) continue;\n        const size = after[path][0];\n        if (!size) {\n          const warning = \"Файл пустой: \" + name;\n          append(\"⚠ \" + warning);\n          skippedFiles.push(warning);\n          continue;\n        }\n        if (size > 25 * 1024 * 1024 || totalBytes + size > 50 * 1024 * 1024) {\n          const warning = size > 25 * 1024 * 1024\n            ? name + \" (больше 25 МБ)\"\n            : name + \" (превышен общий лимит 50 МБ)\";\n          append(\"⚠ Файл пропущен: \" + warning);\n          skippedFiles.push(warning);\n          continue;\n        }\n        const bytes = py.FS.readFile(path);\n        parent.postMessage({type:\"device-code-file\", name:name, mime:mimeFor(name), bytes:bytes, messageId:runMessageId, background:backgroundMode}, \"*\");\n        totalBytes += size;\n        exported += 1;\n      }\n    } catch (e) {\n      append(\"Не удалось подготовить созданные файлы: \" + errorText(e));\n    }\n    const skippedSummary = skippedFiles.length\n      ? \" Пропущено: \" + skippedFiles.slice(0, 5).join(\"; \") + (skippedFiles.length > 5 ? \"; и ещё \" + (skippedFiles.length - 5) : \"\")\n      : \"\";\n    if (exported || skippedFiles.length) {\n      append(\"Файлов подготовлено: \" + exported + \". Ссылки появятся в сообщении.\" + skippedSummary);\n      notify(\"Python выполнен. Файлов создано: \" + exported + \".\" + skippedSummary);\n    } else if (!runError) {\n      append(\"Код завершён. Новых файлов для скачивания не создано.\");\n      notify(\"Python-код выполнен.\");\n    }\n    try { parent.postMessage({type:\"device-code-complete\", success:!runError && !skippedFiles.length, files:exported, skipped:skippedFiles.slice(0, 10), messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n  } catch (e) {\n    const detail = errorText(e);\n    out.textContent += \"\\nНе удалось запустить Python: \" + detail +\n      \"\\nПроверьте подключение к CDN и совместимость библиотек, затем повторите запуск.\";\n    notify(\"Не удалось запустить Python: \" + detail.slice(0, 180));\n    try { parent.postMessage({type:\"device-code-error\", message:detail, messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n    try { parent.postMessage({type:\"device-code-complete\", success:false, files:0, messageId:runMessageId, background:backgroundMode}, \"*\"); } catch (_) {}\n  }\n})();";


  const EFFORTS = ['low', 'medium', 'high', 'extra', 'max'];
  const EFFORT_LABELS = ['Low', 'Medium', 'High', 'Extra', 'Max'];



  const GREETINGS = [
    'Создадим документ?', 'Оформим таблицу?', 'Подготовим презентацию?',
    'Соберём PDF-файл?', 'Создадим SVG-иллюстрацию?', 'Нарисуем схему в SVG?',
    'Подготовим отчёт в DOCX?', 'Соберём Excel-файл?', 'Оформим резюме в DOCX?',
    'Сделаем таблицу с формулами?', 'Создадим диаграмму для документа?',
    'Сверстаем HTML-файл?', 'Подготовим PNG-инфографику?',
    'Преобразуем файл в другой формат?', 'Оформим документ по шаблону?',
    'Создадим PDF с графиками?', 'Соберём комплект файлов?',
    'Подготовим презентацию с таблицами?', 'Оформим титульную страницу?',
    'Добавим график в таблицу?'
  ];

  // ---------- auth ----------  // ---------- auth ----------
  function updateAuthCta() {
    const isGuest = !!(state.user && state.user.is_guest);
    const registerButton = $('#register-btn');
    const continueButton = $('#continue-guest-btn');
    if (registerButton && state.user) registerButton.classList.toggle('hidden', !isGuest);
    if (continueButton) continueButton.classList.toggle('hidden', !isGuest);
    const who = $('#who');
    if (who) who.textContent = state.user
      ? (isGuest ? 'Гость' : ((state.user.name || state.user.email) + (state.user.is_admin ? ' · admin' : '')))
      : 'Аккаунт';
  }

  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#main-screen').classList.add('hidden');
    updateAuthCta();
  }
  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#main-screen').classList.remove('hidden');
    updateAuthCta();
  }

  function bindAuth() {
    const loginForm = $('#login-form'), regForm = $('#register-form');
    const registerButton = $('#register-btn');
    const continueGuestButton = $('#continue-guest-btn');
    if (registerButton) registerButton.addEventListener('click', () => {
      loginForm.classList.add('hidden');
      regForm.classList.remove('hidden');
      $('#auth-error').textContent = '';
      showAuth();
    });
    if (continueGuestButton) continueGuestButton.addEventListener('click', async () => {
      $('#auth-error').textContent = '';
      try {
        const out = await requestGuestSession();
        if (state.user && state.user.id !== out.user.id) {
          state.currentChatId = null; state.tree = []; state.chats = []; state.choices = {};
        }
        state.user = out.user;
        state.identityReady = true;
        window.__csrf = out.csrf_token;
        await boot();
      } catch (err) {
        $('#auth-error').textContent = 'Не удалось открыть гостевую сессию: ' + err.message;
      }
    });
    $$('[data-mode]').forEach(a => a.addEventListener('click', () => {
      const mode = a.dataset.mode;
      loginForm.classList.toggle('hidden', mode !== 'login');
      regForm.classList.toggle('hidden', mode !== 'register');
      $('#auth-error').textContent = '';
    }));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').textContent = '';
      try {
        const out = await api.post('/api/auth/login', {
          email: $('#login-email').value.trim(),
          password: $('#login-password').value,
        });
        window.__csrf = out.csrf_token;
        state.user = out.user;
        state.identityReady = true;
        await boot();
      } catch (err) { $('#auth-error').textContent = 'Ошибка входа: ' + err.message; }
    });

    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').textContent = '';
      try {
        const out = await api.post('/api/auth/register', {
          email: $('#reg-email').value.trim(),
          password: $('#reg-password').value,
          name: $('#reg-name').value.trim(),
        });
        window.__csrf = out.csrf_token;
        state.user = out.user;
        state.identityReady = true;
        await boot();
      } catch (err) { $('#auth-error').textContent = 'Ошибка регистрации: ' + err.message; }
    });
  }

  // ---------- chats ----------
  async function loadChats() {
    const requestId = ++state.chatListRequestId;
    const versionAtStart = state.chatListVersion;
    const queryAtStart = state.query;
    const result = await api.get('/api/chats' + (queryAtStart ? '?q=' + encodeURIComponent(queryAtStart) : ''));
    // An earlier boot/search response must not overwrite a newer list or chat create/rename/delete.
    if (requestId !== state.chatListRequestId ||
        versionAtStart !== state.chatListVersion || queryAtStart !== state.query) return;
    if (!Array.isArray(result)) {
      throw new Error('Сервер вернул некорректный список чатов');
    }
    // Ignore malformed/null rows from stale responses instead of crashing on c.id.
    state.chats = result.filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
    renderChatList();
  }

  function upsertChat(chat) {
    if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !chat.id) return false;
    state.chats = (Array.isArray(state.chats) ? state.chats : [])
      .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
    const index = state.chats.findIndex(item => item.id === chat.id);
    if (index >= 0) state.chats[index] = { ...state.chats[index], ...chat };
    else state.chats.unshift(chat);
    state.chatListVersion += 1;
    return true;
  }

  function setChatCreationPending(pending) {
    state.chatCreating = !!pending;
    ['#new-chat-btn', '#new-code-btn'].forEach(selector => {
      const button = $(selector);
      if (!button) return;
      const comingSoon = selector === '#new-code-btn';
      button.disabled = comingSoon || state.chatCreating;
      button.setAttribute('aria-busy', String(!comingSoon && state.chatCreating));
    });
  }

  function chatDisplayTitle(chat, fallback) {
    const name = String(chat && chat.title || fallback || 'Новый чат');
    return chat && chat.mode === 'research' ? '🧭 ' + name : name;
  }

  function refreshCurrentChatTitle(fallback) {
    const title = $('#chat-title');
    if (!title) return;
    const chat = (state.chats || []).find(item => item && item.id === state.currentChatId) || null;
    title.textContent = chatDisplayTitle(chat, fallback || 'Чат');
    const generating = !!(chat && chat.is_generating) || !!(
      state.streaming && state.generatingChatId && state.generatingChatId === state.currentChatId
    );
    title.classList.toggle('is-generating', generating);
  }

  function chatListItemHtml(chat, options) {
    const pinned = !!chat.is_pinned;
    const showPin = !(options && options.hidePin);
    return '<div class="chat-item' + (chat.id === state.currentChatId ? ' active' : '') + '" data-id="' + escapeHtml(chat.id) + '">' +
      (chat.is_generating ? '<span class="chat-generating-spinner" role="status" aria-label="Запрос обрабатывается"></span>' : '') +
      (chat.mode === 'research' ? '<span class="chat-mode-emoji" title="Deep Research" aria-label="Deep Research">🧭</span>' : '') +
      '<span class="title">' + escapeHtml(chat.title || 'Новый чат') + '</span>' +
      ((chat.mode === 'code' || chat.mode === 'council' || (chat.bundle_id && chat.mode !== 'council')) ?
        '<span class="chat-meta">' +
          (chat.mode === 'code' ? '<em class="mode-tag">код</em>' : '') +
          (chat.mode === 'council' ? '<em class="mode-tag">совет</em>' : '') +
          (chat.bundle_id && chat.mode !== 'council' ? '<em class="bundle-tag">совет</em>' : '') +
        '</span>' : '') +
      '<span class="acts">' +
        (showPin ? '<button data-act="pin" title="' + (pinned ? 'Открепить чат' : 'Закрепить чат') + '" aria-label="' +
          (pinned ? 'Открепить чат' : 'Закрепить чат') + '">' + icon('bookmark') + '</button>' : '') +
        '<button data-act="rename" title="Переименовать" aria-label="Переименовать">' + icon('pencil') + '</button>' +
        '<button data-act="delete" title="Удалить" aria-label="Удалить">' + icon('trash') + '</button>' +
      '</span></div>';
  }

  function bindChatListContainer(container) {
    if (!container) return;
    container.onclick = event => {
      const row = event.target.closest('.chat-item');
      if (!row || !container.contains(row)) return;
      const id = String(row.dataset.id || '');
      const button = event.target.closest('[data-act]');
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.act === 'rename') return openRename(id);
        if (button.dataset.act === 'delete') return removeChat(id);
        if (button.dataset.act === 'pin') return toggleChatPin(id);
      }
      openChat(id);
    };
  }

  function renderPinnedChats() {
    const section = $('#pinned-chat-section');
    const list = $('#pinned-chat-list');
    const allButton = $('#pinned-all-btn');
    if (!section || !list || !allButton) return;
    const pinned = (Array.isArray(state.chats) ? state.chats : [])
      .filter(chat => chat && chat.is_pinned)
      .sort((a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0));
    section.classList.toggle('hidden', pinned.length === 0);
    list.innerHTML = pinned.length ? chatListItemHtml(pinned[0]) : '';
    allButton.classList.toggle('hidden', pinned.length <= 1);
    allButton.onclick = () => {
      const body = '<div class="pinned-modal-list">' + pinned.map(chat =>
        '<button type="button" class="pinned-modal-row" data-pinned-open="' + escapeHtml(chat.id) + '">' +
        '<span>' + icon('bookmark') + '</span><span><strong>' + escapeHtml(chat.title || 'Новый чат') +
        '</strong><small>' + escapeHtml(chat.project_id ? ((workspaceProjectsData || []).find(p => p.id === chat.project_id)?.title || 'Проект') : 'Личный чат') +
        '</small></span>' + icon('chevron-down') + '</button>'
      ).join('') + '</div>';
      openModal({ title: 'Все закреплённые чаты', okText: 'Закрыть', body, onOk: () => true });
      $$('[data-pinned-open]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.pinnedOpen;
        closeModal();
        await openChat(id);
      }));
    };
    bindChatListContainer(list);
  }

  async function toggleChatPin(chatId, forcedValue) {
    let chat = (state.chats || []).find(item => item && String(item.id) === String(chatId));
    if (!chat) {
      try {
        chat = await api.get('/api/chats/' + encodeURIComponent(chatId));
        upsertChat(chat);
      } catch (error) {
        toast('Не удалось загрузить чат: ' + error.message, 'error');
        return false;
      }
    }
    const pinned = forcedValue === undefined ? !chat.is_pinned : !!forcedValue;
    try {
      const updated = await api.patch('/api/chats/' + encodeURIComponent(chatId), { is_pinned: pinned });
      const index = state.chats.findIndex(item => item && String(item.id) === String(chatId));
      if (index >= 0) state.chats[index] = { ...state.chats[index], ...updated };
      state.chatListVersion += 1;
      renderChatList();
      toast(pinned ? 'Чат закреплён' : 'Чат откреплён');
      return true;
    } catch (error) {
      toast('Не удалось изменить закрепление: ' + error.message, 'error');
      return false;
    }
  }

  function renderChatList() {
    const box = $('#chat-list');
    // An incomplete or stale response must never crash sidebar rendering.
    state.chats = (Array.isArray(state.chats) ? state.chats : [])
      .filter(chat => chat && typeof chat === 'object' && typeof chat.id === 'string' && chat.id);
    renderPinnedChats();
    if (!state.chats.length) {
      box.innerHTML = '<div class="side-empty">' + (state.query ? 'Ничего не найдено' : 'Пока нет чатов') + '</div>';
      bindChatListContainer(box);
      return;
    }
    box.innerHTML = state.chats.map(chat => chatListItemHtml(chat)).join('');
    bindChatListContainer(box);
  }

  async function newChat(mode) {
    if (!state.identityReady) { toast('Подключаем сессию…', 'info'); return; }
    // A second click during a slow POST must not create another empty chat.
    if (state.chatCreating) return;
    setChatCreationPending(true);
    const selectionToken = state.chatOpenToken;
    let chat = null;
    try {
      chat = await api.post('/api/chats', {
        title: 'Новый чат',
        mode: mode || 'chat',
      });
      if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !chat.id) {
        throw new Error('Сервер не вернул созданный чат с корректным ID');
      }
      upsertChat(chat);
      if (pendingNewChatProjectId) {
        const projectId = pendingNewChatProjectId;
        const updated = await api.patch('/api/chats/' + encodeURIComponent(chat.id), { project_id: projectId });
        chat = { ...chat, ...updated };
        upsertChat(chat);
        pendingNewChatProjectId = '';
        pendingNewChatProjectLabel = '';
        renderAddChatActionLabels();
      }
      // Respect a later user selection made while the create request was in flight.
      if (selectionToken === state.chatOpenToken) {
        const opened = await openChat(chat.id);
        if (opened) {
          const input = $('#input');
          if (input) input.focus();
        }
      } else {
        renderChatList();
      }
    } catch (error) {
      toast(chat ? 'Чат создан, но не удалось открыть его: ' + (error.message || error)
        : 'Не удалось создать чат: ' + (error.message || error), 'error');
      if (chat) renderChatList();
    } finally {
      setChatCreationPending(false);
    }
  }

  function openRename(id) {
    const chat = state.chats.find(c => c.id === id);
    openModal({
      title: 'Переименовать чат',
      body: '<input id="rename-input" value="' + escapeHtml(chat ? chat.title : '') + '" />',
      onOk: async (root) => {
        const val = $('#rename-input', root).value.trim();
        if (!val) return false;
        const upd = await api.patch('/api/chats/' + id, { title: val });
        const i = state.chats.findIndex(c => c.id === id);
        if (i >= 0) state.chats[i] = upd;
        state.chatListVersion += 1;
        renderChatList();
        if (state.currentChatId === id) refreshCurrentChatTitle(upd.title);
        return true;
      },
    });
  }

  async function removeChat(id) {
    if (!confirm('Удалить чат вместе со всеми сообщениями?')) return;
    await api.del('/api/chats/' + id);
    state.chatListVersion += 1;
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.currentChatId === id) {
      state.currentChatId = null; state.tree = []; state.choices = {};
      $('#chat-title').textContent = 'AI CH';
      $('#chat-title').classList.remove('is-generating');
      renderMessages();
    }
    renderChatList();
  }

  async function openChat(id) {
    if (typeof id !== 'string' || !id.trim()) return false;
    const requestToken = ++state.chatOpenToken;
    state.chatLoading = true;
    $$('.chat-item').forEach(item => item.removeAttribute('aria-busy'));
    const clickedItem = $$('.chat-item').find(item => item.dataset.id === id);
    if (clickedItem) clickedItem.setAttribute('aria-busy', 'true');
    const sendButton = $('#send-btn');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.setAttribute('aria-busy', 'true');
    }
    try {
      // Keep the old active chat until the requested history has loaded successfully.
      const loadedTree = await api.get('/api/chats/' + encodeURIComponent(id) + '/messages');
      if (requestToken !== state.chatOpenToken) return false;
      if (!Array.isArray(loadedTree)) throw new Error('Сервер вернул некорректную историю чата');

      if (state.currentChatId !== id) {
        closeChatSearch();
        state.stickBottom = true;
      }
      state.currentChatId = id;
      state.choices = {};
      state.tree = loadedTree.filter(node => node && typeof node === 'object' && !Array.isArray(node));
      const liveStream = window.__aichActiveStream;
      if (state.streaming && liveStream) {
        state.activeAssistantId = liveStream.chatId === id ? liveStream.assistantId : null;
      }
      const chat = (Array.isArray(state.chats) ? state.chats : [])
        .find(c => c && typeof c === 'object' && c.id === id);
      if (chat && chat.model_set_id) {
        const selectedCluster = state.modelSets.find(s => s.id === chat.model_set_id && modelSetCanUse(s));
        if (selectedCluster) { state.modelSetId = selectedCluster.id; localStorage.setItem('aich_model_set_id', selectedCluster.id); }
      }
      renderModelPicker();
      renderAddChatActionLabels();
      refreshCurrentChatTitle(chat ? (chat.title || 'Новый чат') : 'Чат');
      renderChatList();
      renderMessages();
      if (state.streaming && liveStream && liveStream.chatId === id && liveStream.assistantId) bindStreamRefs();
      const isCode = !!(chat && chat.mode === 'code');
      $('#project-btn').classList.toggle('hidden', !isCode);
      if (isCode) { toggleProjectPanel(true); } else { toggleProjectPanel(false); }
      closeMobileSidebar();
      // A secondary usage endpoint failure must not undo a successfully loaded chat.
      loadUsage().catch(error => console.warn('Usage refresh after chat switch failed:', error));
      return true;
    } catch (error) {
      if (requestToken === state.chatOpenToken) {
        console.error('Chat history load failed:', error);
        toast('Не удалось открыть чат: ' + usefulErrorMessage(error, 'ошибка загрузки истории') +
          '. Предыдущий чат сохранён — нажмите ещё раз, чтобы повторить загрузку.', 'error');
      }
      return false;
    } finally {
      if (requestToken === state.chatOpenToken) {
        state.chatLoading = false;
        $$('.chat-item').forEach(item => item.removeAttribute('aria-busy'));
        const button = $('#send-btn');
        if (button) {
          button.disabled = !!(state.streaming || state.sending);
          button.setAttribute('aria-busy', 'false');
        }
      }
    }
  }

  async function renameCurrentChat() {
    if (!state.currentChatId) return;
    openRename(state.currentChatId);
  }

  // ---------- messages ----------
  function findNode(nodes, id) {
    if (!Array.isArray(nodes) || id == null) return null;
    for (const n of nodes) {
      // Histories can contain malformed/null rows; never let one break sending.
      if (!n || typeof n !== 'object') continue;
      if (n.id === id) return n;
      const children = Array.isArray(n.children) ? n.children : [];
      const f = findNode(children, id);
      if (f) return f;
    }
    return null;
  }

  function insertMessage(tree, msg) {
    const node = Object.assign({}, msg, { children: [] });
    if (msg.parent_message_id) {
      const parent = findNode(tree, msg.parent_message_id);
      if (parent) { parent.children = parent.children || []; parent.children.push(node); return node; }
    }
    tree.push(node);
    return node;
  }

  function activePath(tree, choices) {
    const path = [];
    let nodes = Array.isArray(tree) ? tree : [];
    const selected = choices && typeof choices === 'object' ? choices : {};
    let parentKey = 'root';
    while (Array.isArray(nodes) && nodes.length) {
      // Remove invalid entries before resolving a branch index or reading node.id.
      const siblings = nodes.filter(node =>
        node && typeof node === 'object' && typeof node.id === 'string' && node.id
      );
      if (!siblings.length) break;
      const rawIndex = selected[parentKey];
      let idx = rawIndex == null ? NaN : Number(rawIndex);
      if (!Number.isInteger(idx) || idx >= siblings.length || idx < 0) idx = siblings.length - 1;
      const node = siblings[idx];
      path.push({ node, siblings, index: idx, parentKey });
      nodes = Array.isArray(node.children) ? node.children : [];
      parentKey = node.id;
    }
    return path;
  }

  function allMessages(tree) {
    const entries = [];
    const seen = new Set();
    const visit = (nodes) => {
      let siblings = (Array.isArray(nodes) ? nodes : [])
        .filter(node => node && typeof node === 'object' &&
          typeof node.id === 'string' && node.id && !seen.has(node));
      const times = siblings.map(node => Date.parse(node.created_at || ''));
      // Keep all sibling generations together, oldest first when timestamps are available.
      if (times.length > 1 && times.every(Number.isFinite)) {
        siblings = siblings.map((node, index) => ({ node, index, time: times[index] }))
          .sort((a, b) => a.time - b.time || a.index - b.index)
          .map(item => item.node);
      }
      siblings.forEach(node => {
        seen.add(node);
        entries.push({ node });
      });
      // Render alternatives first, then their descendants, so regenerated answers stay adjacent.
      siblings.forEach(node => visit(node.children));
    };
    visit(tree);
    return entries;
  }

  function attsHtml(atts) {
    if (!Array.isArray(atts) || !atts.length) return '';
    return '<div class="msg-atts">' + atts.map(a => {
      const fileId = encodeURIComponent(String(a.file_id || ''));
      const url = '/api/files/' + fileId + '/download';
      const name = String(a.name || a.original_name || '');
      const isSvg = a.kind === 'svg' || /\.svg$/i.test(name);
      const isSvgMime = String(a.mime_type || '').toLowerCase() === 'image/svg+xml';
      const isImage = !isSvg && !isSvgMime && (a.kind === 'image' ||
        String(a.mime_type || '').toLowerCase().startsWith('image/'));
      if (isImage || isSvg || isSvgMime) {
        const previewUrl = isSvg || isSvgMime ? url + '?inline=1' : '/api/files/' + fileId + '/thumbnail';
        return '<a class="msg-att img' + (isSvg || isSvgMime ? ' svg' : '') +
          '" href="' + url + '" target="_blank" rel="noopener" title="' + escapeHtml(name) +
          '"><img src="' + previewUrl + '" alt="' + escapeHtml(name) +
          '" loading="lazy" decoding="async" /></a>';
      }
      return '<a class="msg-att" href="' + url + '" target="_blank" rel="noopener" title="' +
        escapeHtml(a.name) + '">' +
        '<span class="att-icon">' + icon('file') + '</span>' +
        '<span class="att-name">' + escapeHtml(a.name) + '</span>' +
        '<span class="att-size">' + formatSize(a.size) + '</span></a>';
    }).join('') + '</div>';
  }

  function thinkAnim() {
    return '<span class="think-anim" aria-hidden="true"><i class="core"></i></span>';
  }

  function genAnim(label) {
    return '<span class="gen-anim">' +
      '<span class="gen-anim-icon">' + thinkAnim() + '</span>' +
      '<span class="gen-anim-text">' + escapeHtml(label || 'Создаю чат…') + '</span>' +
      '</span>';
  }


  // Public activity stream: brief status summaries only, never provider private reasoning.
  const ACTIVITY_ICON_NAMES = new Set([
    'book','book-open','bookmark','file-text','file-search','file-code','presentation','code',
    'calculator','ruler','pencil-ruler','layers','database','list-checks','compass','lightbulb',
    'check-circle','chart-line','pie-chart','image','palette','map','calendar','clock','shield-check',
    'package','network','microscope','flask','graduation-cap','target','workflow','upload','wrench',
    'scan','table','type','eye','puzzle','notebook','arrow-right','search-code','list-todo','pen-tool',
    'brain','sparkle','globe','terminal','folder','link','file','chart','sheet','slides','search',
    'check','refresh','lock','user','settings'
  ]);

  function activityStorageKey(id) { return 'aich:activities:' + String(id || ''); }

  function activityItems(n) {
    if (!n) return [];
    if (!Array.isArray(n.activities)) {
      n.activities = [];
      try {
        const saved = JSON.parse(localStorage.getItem(activityStorageKey(n.id)) || '[]');
        if (Array.isArray(saved)) {
          n.activities = saved.filter(item => item && ['status', 'action'].includes(item.kind) &&
            typeof item.text === 'string').slice(-60);
        }
        const savedStarted = localStorage.getItem(activityStorageKey(n.id) + ':started');
        const savedElapsed = localStorage.getItem(activityStorageKey(n.id) + ':elapsed');
        const started = savedStarted === null ? NaN : Number(savedStarted);
        const elapsed = savedElapsed === null ? NaN : Number(savedElapsed);
        if (Number.isFinite(started) && started > 0) n.activityStartedAt = started;
        if (Number.isFinite(elapsed) && elapsed >= 0) n.activityElapsedMs = elapsed;
      } catch (e) { /* unavailable storage must not interrupt chat rendering */ }
    }
    return n.activities;
  }

  function saveActivityItems(n) {
    if (!n || !n.id) return;
    try {
      localStorage.setItem(activityStorageKey(n.id), JSON.stringify(activityItems(n).slice(-60)));
      if (Number.isFinite(Number(n.activityStartedAt)) && Number(n.activityStartedAt) > 0) localStorage.setItem(activityStorageKey(n.id) + ':started', String(n.activityStartedAt));
      if (n.activityElapsedMs !== undefined && Number.isFinite(Number(n.activityElapsedMs))) localStorage.setItem(activityStorageKey(n.id) + ':elapsed', String(n.activityElapsedMs));
    } catch (e) { /* storage quota/private mode: the current chat still works */ }
  }

  function appendActivity(n, item) {
    if (!n || !item || !['status', 'action'].includes(item.kind)) return;
    const rawText = String(item.text || '');
    const text = (item.kind === 'status' ? stripActivityEmoji(rawText) : rawText)
      .replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!text) return;
    const activities = activityItems(n);
    const iconName = item.kind === 'action' && ACTIVITY_ICON_NAMES.has(String(item.icon || ''))
      ? String(item.icon) : 'sparkle';
    const next = { kind: item.kind, text: text, icon: iconName, at: Date.now() };
    const last = activities[activities.length - 1];
    if (last && last.kind === next.kind && last.text === next.text && last.icon === next.icon) return;
    activities.push(next);
    if (activities.length > 60) activities.splice(0, activities.length - 60);
    saveActivityItems(n);
    renderActivityPopup(n);
  }

  function latestActivityLabel(n) {
    // While the dedicated status model is preparing its first status, show the usual thinking label.
    const modelStatus = String(n && n.statusModelCurrent || '').trim();
    return modelStatus || 'Думаю';
  }

  function formatActivityDuration(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    if (total < 60) return total + ' сек.';
    const minutes = Math.floor(total / 60), seconds = total % 60;
    return minutes + ' мин' + (seconds ? ' ' + seconds + ' сек.' : '');
  }

  function activityStartTime(n) {
    const started = Number(n && n.activityStartedAt);
    if (Number.isFinite(started) && started > 0) return started;
    const created = Date.parse(n && n.created_at || '');
    return Number.isFinite(created) && created > 0 ? created : Date.now();
  }

  function activityElapsed(n, generating) {
    const started = activityStartTime(n);
    if (generating) return Math.max(0, Date.now() - started);
    const elapsed = n && n.activityElapsedMs;
    if (elapsed !== undefined && elapsed !== null && Number.isFinite(Number(elapsed)) && Number(elapsed) >= 0) {
      return Number(elapsed);
    }
    const ended = Number(n && n.activityFinishedAt);
    return Number.isFinite(ended) && ended > 0 ? Math.max(0, ended - started) : 0;
  }

  function stripActivityEmoji(text) {
    return String(text || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D\u20E3]/gu, '')
      .replace(/\s+/g, ' ').trim();
  }

  function activityStatusEmoji(text, n) {
    const savedEmoji = String(n && n.statusModelEmoji || '').trim();
    if (savedEmoji) return savedEmoji;
    const value = stripActivityEmoji(text).toLowerCase();
    if (/(ошиб|не удалось|недоступ|сбой|failed|error)/u.test(value)) return '🛠️';
    if (/(интернет|поиск|источник|веб|сайт|страниц|ссылк)/u.test(value)) return '🔎';
    if (/(код|песочниц|запуск|выполн|исполн|скрипт|программ|команд|python|javascript)/u.test(value)) return '💻';
    if (/(вычис|математ|формул|уравнен|арифмет|расч[её]т)/u.test(value)) return '🧮';
    if (/(презентац|слайд)/u.test(value)) return '📊';
    if (/(таблиц|excel|xlsx|csv|ячейк|данн)/u.test(value)) return '📋';
    if (/(изображ|фото|картин|рисунк|svg|png|визуал)/u.test(value)) return '🎨';
    if (/(график|диаграм|метрик|аналитик)/u.test(value)) return '📈';
    if (/(файл|документ|pdf|docx|текст|письм|формулир)/u.test(value)) return '📄';
    if (/(план|этап|структур|порядок|шаг)/u.test(value)) return '🗂️';
    if (/(перевод|язык|терминолог)/u.test(value)) return '🌐';
    if (/(провер|сверя|готов|заверш|результат|итог|точност|противореч)/u.test(value)) return '🔍';
    if (/(объясн|анализ|сравн|истор|литератур|исслед|контекст)/u.test(value)) return '📚';
    if (/(связ|маршрут|выбира|вариант|решени|подход)/u.test(value)) return '🧭';
    return '✨';
  }

  const ACTIVITY_STATUS_THEME_ICONS = {
    '🛠': 'wrench', '📊': 'chart', '🧮': 'calculator', '🔎': 'search',
    '📋': 'table', '🎨': 'palette', '🌐': 'globe-box', '🗄': 'database',
    '💻': 'terminal', '🔍': 'search', '📚': 'book-open', '🗂': 'folder-open',
    '📝': 'pencil', '✍': 'pencil', '💬': 'chat', '📄': 'file-text',
    '🔬': 'microscope', '📈': 'chart-line', '🧭': 'compass', '🧠': 'brain',
    '✨': 'sparkle'
  };

  function activityStatusIconHtml(text, n) {
    const emoji = activityStatusEmoji(text, n);
    const normalizedEmoji = emoji.replace(/\uFE0F/g, '');
    const themedItem = themedEmojiItem(emoji);
    const iconName = ACTIVITY_STATUS_THEME_ICONS[normalizedEmoji] ||
      (themedItem && themedItem.symbol) || 'sparkle';
    return '<span class="activity-status-emoji" aria-hidden="true">' +
      icon(iconName, 'aich-themed-emoji-icon') + '</span>';
  }

  function latestActivityEmojiHtml(n) {
    return activityStatusIconHtml(latestActivityLabel(n), n);
  }

  function deviceCodeForFilePlan(planSource) {
    let plan;
    try { plan = JSON.parse(String(planSource || '')); } catch (e) { return ''; }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return '';
    const planLiteral = JSON.stringify(String(planSource));
    return [
      "import csv, json, re, html, textwrap",
      "from pathlib import Path",
      "plan = json.loads(" + planLiteral + ")",
      "aliases = {'presentation':'pptx','slides':'pptx','powerpoint':'pptx','word':'docx','document':'docx','excel':'xlsx','spreadsheet':'xlsx','markdown':'md','text':'txt','vector':'svg','image':'png'}",
      "fmt = aliases.get(str(plan.get('format') or '').strip().lower().lstrip('.'), str(plan.get('format') or '').strip().lower().lstrip('.'))",
      "exts = {'pptx':'.pptx','docx':'.docx','xlsx':'.xlsx','pdf':'.pdf','svg':'.svg','png':'.png','csv':'.csv','json':'.json','md':'.md','txt':'.txt'}",
      "if fmt not in exts: raise ValueError('Локальный резервный сборщик не поддерживает формат: ' + fmt)",
      "title = str(plan.get('title') or 'Созданный файл').strip()[:180]",
      "name = str(plan.get('filename') or title or 'ai-ch-file').replace('\\\\','/').split('/')[-1]",
       "name = re.sub(r'\\.(ppt|doc|xls)_$', lambda m: '.' + m.group(1) + 'x', name, flags=re.I)",
      "name = re.sub(r'\\.[A-Za-z0-9]{1,8}$', '', name)",
       "name = re.sub(r'^(?:(?:pptx?|docx?|word|xlsx?|excel|pdf|svg|png|csv|json|markdown|md|text|txt)[\\s._-]*)+', '', name, flags=re.I)",
      "name = ''.join(ch if ch.isalnum() or ch in ' .-_' else '-' for ch in name).strip(' .-_')[:100] or 'ai-ch-file'",
      "filename = name + exts[fmt]",
      "blocks = plan.get('blocks') or plan.get('slides') or plan.get('sections') or plan.get('items') or []",
      "blocks = [b if isinstance(b,dict) else {'kind':'text','text':str(b)} for b in blocks if b is not None][:36]",
      "def kind(b): return str(b.get('kind') or b.get('layout') or b.get('type') or 'text').lower().replace('-','_')",
       "def body(b):",
       "    value = b.get('text') or b.get('body') or b.get('content')",
       "    if value: return str(value)",
       "    head = b.get('head') or []; rows = b.get('rows') or []",
       "    if head or rows: return '; '.join([' | '.join(map(str, row)) for row in ([head] if head else []) + rows])",
       "    items = b.get('items') or []",
       "    if items: return ' · '.join((str(x.get('label') or '') + ': ' + str(x.get('value') or '')) if isinstance(x,dict) else str(x) for x in items)",
       "    return ''",
      "def heading(b,i): return str(b.get('title') or b.get('kicker') or ('Раздел '+str(i+1)))[:150]",
      "if fmt == 'pptx':",
      "    from pptx import Presentation",
      "    from pptx.util import Inches, Pt",
      "    from pptx.dml.color import RGBColor",
      "    prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5); blank = prs.slide_layouts[6]",
      "    def add_text(slide,x,y,w,h,value,size=17,bold=False,color=(38,37,34)):",
      "        shape=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)); tf=shape.text_frame; tf.word_wrap=True; tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0",
      "        p=tf.paragraphs[0]; p.line_spacing=1.12; r=p.add_run(); r.text=str(value); r.font.name='Arial'; r.font.size=Pt(size); r.font.bold=bold; r.font.color.rgb=RGBColor(*color)",
      "    cover=prs.slides.add_slide(blank); add_text(cover,.9,1.5,11.4,1.25,title,36,True); add_text(cover,.9,3.0,10.8,1.2,str(plan.get('subtitle') or ''),20,False,(95,94,88))",
      "    for idx,b in enumerate(blocks[:24]):",
      "        slide=prs.slides.add_slide(blank); add_text(slide,.8,.55,11.8,.8,heading(b,idx),27,True,(49,73,101)); y=1.75; k=kind(b)",
      "        if k == 'table':",
      "            head=b.get('head') or []; rows=(b.get('rows') or [])[:12]; cols=min(6,max([len(head)]+[len(r) for r in rows]+[0]))",
      "            if cols:",
      "                tb=slide.shapes.add_table(len(rows)+1,cols,Inches(.8),Inches(y),Inches(11.7),Inches(min(4.4,.32*(len(rows)+1)))).table",
      "                for ri,row in enumerate([head]+rows):",
      "                    for ci in range(cols):",
      "                        cell=tb.cell(ri,ci); cell.text=str(row[ci])[:250] if ci<len(row) else ''",
      "                        for para in cell.text_frame.paragraphs:",
      "                            for run in para.runs: run.font.size=Pt(10); run.font.bold=(ri==0)",
      "        elif k in ('bullets','numbers','list','steps','ordered_list','unordered_list'):",
      "            for ix,item in enumerate((b.get('items') or [])[:14]): add_text(slide,.95,y+ix*.34,11.3,.3,('• ' if k!='numbers' else str(ix+1)+'. ')+str(item),15)",
      "        elif k in ('metrics','metric','stats','kpi'):",
      "            for ix,item in enumerate((b.get('items') or [])[:4]): add_text(slide,.95,y+ix*.85,11.3,.4,(str(item.get('value',''))+'  '+str(item.get('label',''))) if isinstance(item,dict) else str(item),20,True,(66,105,146))",
      "        else: add_text(slide,.95,y,11.3,4.65,body(b),17)",
      "    prs.save(filename)",
      "elif fmt == 'docx':",
      "    from docx import Document",
      "    from docx.shared import Inches",
      "    doc=Document(); sec=doc.sections[0]; sec.top_margin=sec.bottom_margin=Inches(.7); doc.add_heading(title,0)",
      "    if plan.get('subtitle'): doc.add_paragraph(str(plan['subtitle']))",
      "    for idx,b in enumerate(blocks):",
      "        k=kind(b); h=heading(b,idx)",
       "        if k in ('h1','h2','h3','heading'): doc.add_heading(body(b) or h,level=1 if k in ('h1','heading') else (2 if k=='h2' else 3))",
       "        elif k in ('section','cover','divider'):",
       "            doc.add_heading(h,level=1)",
       "            if body(b): doc.add_paragraph(body(b))",
      "        elif k in ('bullets','numbers','list','steps','ordered_list','unordered_list'):",
      "            for item in (b.get('items') or [])[:30]: doc.add_paragraph(str(item),style='List Number' if k in ('numbers','ordered_list') else 'List Bullet')",
      "        elif k=='table':",
      "            head=b.get('head') or []; rows=(b.get('rows') or [])[:80]; cols=min(12,max([len(head)]+[len(r) for r in rows]+[0]))",
      "            if cols:",
      "                tb=doc.add_table(rows=1,cols=cols); tb.style='Light Shading Accent 1'",
      "                for ci,cell in enumerate(tb.rows[0].cells): cell.text=str(head[ci]) if ci<len(head) else ''",
      "                for row in rows:",
      "                    cells=tb.add_row().cells",
      "                    for ci,cell in enumerate(cells): cell.text=str(row[ci]) if ci<len(row) else ''",
      "        else:",
      "            if h and k not in ('text','paragraph','body'): doc.add_heading(h,level=2)",
      "            if body(b): doc.add_paragraph(body(b))",
      "    doc.save(filename)",
      "elif fmt == 'xlsx':",
      "    from openpyxl import Workbook",
      "    from openpyxl.styles import Font, PatternFill, Alignment",
      "    wb=Workbook(); wb.remove(wb.active); sheets=plan.get('sheets') if isinstance(plan.get('sheets'),list) else []",
      "    if not sheets: sheets=[{'name':title,'head':plan.get('head') or [],'rows':plan.get('rows') or []}]",
       "    tables = [b for b in blocks if kind(b) == 'table' and (b.get('head') or b.get('rows'))]",
       "    if not any((s.get('head') or s.get('rows')) for s in sheets) and tables:",
       "        sheets = [{'name': heading(b,i), 'head': b.get('head') or [], 'rows': b.get('rows') or []} for i,b in enumerate(tables)]",
      "    if not any((s.get('head') or s.get('rows')) for s in sheets) and blocks: sheets=[{'name':title,'head':['Раздел','Содержание'],'rows':[[heading(b,i),body(b)] for i,b in enumerate(blocks)]}]",
      "    for si,spec in enumerate(sheets[:20]):",
      "        sn=''.join(ch for ch in str(spec.get('name') or ('Лист '+str(si+1))) if ch not in '[]:*?/\\\\')[:31] or ('Лист'+str(si+1)); ws=wb.create_sheet(sn); head=spec.get('head') or []; rows=spec.get('rows') or []",
      "        if head: ws.append(list(head))",
      "        for row in rows[:1500]: ws.append(list(row) if isinstance(row,(list,tuple)) else [row])",
      "        if head:",
      "            for cell in ws[1]: cell.font=Font(bold=True,color='FFFFFF'); cell.fill=PatternFill('solid',fgColor='426992'); cell.alignment=Alignment(wrap_text=True)",
      "            ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions",
      "        for col in ws.columns: ws.column_dimensions[col[0].column_letter].width=min(42,max(12,max((len(str(c.value or '')) for c in col[:100]),default=10)+2))",
      "    wb.save(filename)",
      "elif fmt == 'pdf':",
      "    import matplotlib; matplotlib.use('Agg')",
      "    import matplotlib.pyplot as plt",
      "    from matplotlib.backends.backend_pdf import PdfPages",
      "    with PdfPages(filename) as pdf:",
      "        pages=[blocks[i:i+7] for i in range(0,len(blocks),7)] or [[]]",
      "        for pi,page in enumerate(pages):",
      "            fig=plt.figure(figsize=(8.27,11.69)); fig.patch.set_facecolor('#FAF9F5'); fig.text(.09,.94,title,fontsize=22,fontweight='bold',color='#304F70',wrap=True); y=.87",
      "            if plan.get('subtitle') and pi==0: fig.text(.09,y,str(plan['subtitle']),fontsize=11,color='#66645D',wrap=True); y-=.05",
      "            for i,b in enumerate(page):",
      "                fig.text(.09,y,heading(b,i),fontsize=14,fontweight='bold',color='#304F70',wrap=True); y-=.035; txt=textwrap.fill(body(b),width=88)[:3500]; fig.text(.1,y,txt,fontsize=10,color='#282824',va='top',linespacing=1.4); y-=min(.24,.025*(txt.count('\\n')+1)+.055)",
      "            pdf.savefig(fig,bbox_inches='tight'); plt.close(fig)",
      "elif fmt == 'svg':",
      "    esc=html.escape; width=1200; height=max(900,240+len(blocks[:16])*150); parts=[f'<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><rect width=\"100%\" height=\"100%\" fill=\"#FAF9F5\"/><rect width=\"12\" height=\"100%\" fill=\"#426992\"/><text x=\"58\" y=\"90\" font-family=\"Arial,sans-serif\" font-size=\"38\" font-weight=\"700\" fill=\"#262522\">{esc(title)}</text>']",
      "    y=155",
      "    for i,b in enumerate(blocks[:16]):",
      "        parts.append(f'<rect x=\"58\" y=\"{y}\" width=\"1080\" height=\"118\" rx=\"15\" fill=\"#FFFFFF\" stroke=\"#D9D6CE\"/><text x=\"82\" y=\"{y+36}\" font-family=\"Arial,sans-serif\" font-size=\"22\" font-weight=\"700\" fill=\"#426992\">{esc(heading(b,i))}</text><text x=\"82\" y=\"{y+72}\" font-family=\"Arial,sans-serif\" font-size=\"17\" fill=\"#393832\">{esc(textwrap.shorten(body(b),width=115,placeholder=\"…\"))}</text>'); y+=145",
      "    parts.append('</svg>'); Path(filename).write_text('\\n'.join(parts),encoding='utf-8')",
      "elif fmt == 'png':",
      "    from PIL import Image, ImageDraw, ImageFont",
      "    w=1600; h=min(4400,max(900,300+250*max(1,len(blocks)))); im=Image.new('RGB',(w,h),'#FAF9F5'); d=ImageDraw.Draw(im)",
      "    try: title_font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',42); body_font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',23)",
      "    except Exception: title_font=ImageFont.load_default(); body_font=ImageFont.load_default()",
      "    d.rectangle((0,0,w,14),fill='#426992'); d.text((70,60),title,font=title_font,fill='#262522'); y=170",
      "    for i,b in enumerate(blocks[:16]):",
      "        d.rounded_rectangle((65,y,w-65,y+205),radius=18,fill='#FFFFFF',outline='#D9D6CE',width=2); d.text((90,y+25),heading(b,i),font=body_font,fill='#426992'); d.text((90,y+85),textwrap.shorten(body(b),width=125,placeholder='…'),font=body_font,fill='#393832'); y+=235",
      "    im.save(filename,format='PNG',optimize=True)",
      "elif fmt == 'csv':",
      "    sheets=plan.get('sheets') or [{'head':plan.get('head') or [],'rows':plan.get('rows') or []}]",
       "    tables = [b for b in blocks if kind(b) == 'table' and (b.get('head') or b.get('rows'))]",
       "    if not any((s.get('head') or s.get('rows')) for s in sheets) and tables:",
       "        sheets = [{'name': heading(b,i), 'head': b.get('head') or [], 'rows': b.get('rows') or []} for i,b in enumerate(tables)]",
       "    if not any((s.get('head') or s.get('rows')) for s in sheets) and blocks:",
       "        sheets = [{'name': title, 'head': ['Раздел','Содержание'], 'rows': [[heading(b,i),body(b)] for i,b in enumerate(blocks)]}]",
       "    if not any((s.get('head') or s.get('rows')) for s in sheets): raise ValueError('Для CSV добавьте head/rows или табличный блок')",
      "    with open(filename,'w',newline='',encoding='utf-8-sig') as stream:",
      "        writer=csv.writer(stream)",
      "        for i,spec in enumerate(sheets):",
      "            if i: writer.writerow([]); writer.writerow([spec.get('name') or ('Лист '+str(i+1))])",
      "            if spec.get('head'): writer.writerow(spec['head'])",
      "            writer.writerows(spec.get('rows') or [])",
      "elif fmt == 'json': Path(filename).write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')",
      "else:",
      "    out=[title]",
      "    if plan.get('subtitle'): out.extend(['',str(plan['subtitle'])])",
       "    for b in blocks:",
       "        k=kind(b); txt=body(b); heading_text=str(b.get('title') or b.get('kicker') or '')",
       "        hp=('## ' if fmt=='md' else '')",
       "        if k in ('h1','h2','h3'): out.extend(['',('#'*int(k[1])+' ' if fmt=='md' else '')+(txt or heading_text)])",
       "        elif k=='section':",
       "            if heading_text: out.extend(['',hp+heading_text])",
       "            if txt: out.extend(['',txt])",
       "        elif k in ('bullets','numbers','list','steps'):",
       "            if heading_text: out.extend(['',hp+heading_text])",
       "            out.extend(['']+[(str(i+1)+'. ' if k=='numbers' else '- ')+str(v) for i,v in enumerate(b.get('items') or [])])",
       "        elif k=='table':",
       "            if heading_text: out.extend(['',hp+heading_text])",
       "            head=b.get('head') or []; rows=b.get('rows') or []",
       "            if head: out.extend(['','| '+' | '.join(map(str,head))+' |','| '+' | '.join('---' for _ in head)+' |'])",
       "            out.extend('| '+' | '.join(map(str,row))+' |' for row in rows)",
       "        elif k in ('quote','callout'):",
       "            if heading_text: out.extend(['',hp+heading_text])",
       "            if txt: out.extend(['',('> ' if fmt=='md' else '')+txt])",
       "        else:",
       "            if heading_text and heading_text!=txt: out.extend(['',hp+heading_text])",
       "            if txt: out.extend(['',txt])",
       "            elif b.get('items'): out.extend([''] + ['- '+str(v) for v in b.get('items') or []])",
      "    Path(filename).write_text(('\\n'.join(out)).strip()+'\\n',encoding='utf-8')",
      "print('Локальный файл создан:', filename)"
    ].join('\n');
  }

  function openFallbackCodeViewer(sourceCode, language) {
    const source = String(sourceCode || '');
    if (!source.trim()) return;
    const existing = $('.aich-code-viewer-shell');
    if (existing) existing.remove();
    const lang = String(language || 'python').trim().toLowerCase() || 'python';
    const title = languageLabel(lang);
    const extByLang = {python:'py',py:'py',run:'py',javascript:'js',js:'js',html:'html',htm:'html',css:'css',svg:'svg',json:'json',markdown:'md',md:'md',sql:'sql',bash:'sh',sh:'sh'};
    const ext = extByLang[lang] || (lang.match(/^[a-z0-9]{1,8}$/i) ? lang : 'txt');
    const shell = document.createElement('div');
    shell.className = 'aich-code-viewer-shell open';
    shell.setAttribute('role', 'presentation');
    shell.innerHTML =
      '<button class="aich-code-viewer-scrim" type="button" data-code-viewer-close aria-label="Закрыть просмотр кода"></button>' +
      '<section class="aich-code-viewer-panel" role="dialog" aria-modal="true" aria-label="Код · ' + escapeHtml(title) + '" tabindex="-1">' +
      '<header class="aich-code-viewer-head"><div><strong>Код</strong><span class="aich-code-viewer-language">' + escapeHtml(title) + '</span></div>' +
      '<div class="aich-code-viewer-actions"><button type="button" data-code-viewer-copy>' + icon('copy') + 'Скопировать</button>' +
      '<button type="button" data-code-viewer-download>' + icon('download') + 'Скачать</button>' +
      '<button type="button" data-code-viewer-close class="aich-code-viewer-close" aria-label="Закрыть" title="Закрыть">' + icon('x') + '</button></div></header>' +
      '<pre class="aich-code-viewer-source"><code></code></pre></section>';
    const codeNode = $('.aich-code-viewer-source code', shell);
    if (codeNode) codeNode.textContent = source;
    const close = () => {
      shell.remove();
      document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = event => { if (event.key === 'Escape' && document.body.contains(shell)) close(); };
    $$('[data-code-viewer-close]', shell).forEach(button => button.addEventListener('click', close));
    const copyButton = $('[data-code-viewer-copy]', shell);
    if (copyButton) copyButton.addEventListener('click', async () => {
      const ok = await copyText(source);
      toast(ok ? 'Код скопирован' : 'Не удалось скопировать код', ok ? '' : 'error');
    });
    const downloadButton = $('[data-code-viewer-download]', shell);
    if (downloadButton) downloadButton.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([source], {type:'text/plain;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ai-ch-code.' + ext;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500);
    });
    document.body.appendChild(shell);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => $('.aich-code-viewer-panel', shell)?.focus());
  }

  function deviceFallbackLabel(n, run) {
    const source = run && run.kind === 'fileplan' ? String(run.device_plan || '') : String(run && run.code || '');
    let title = '', format = '';
    if (run && run.kind === 'fileplan') {
      try {
        const plan = JSON.parse(source);
        title = String(plan.title || plan.filename || '').trim();
        format = String(plan.format || '').trim().toLowerCase().replace(/^\./, '');
      } catch (e) {}
    }
    const authoredAction = source.match(/^\s*#\s*AI_CH_ACTION:\s*(.+)$/im);
    if (authoredAction && authoredAction[1].trim()) return authoredAction[1].trim().slice(0, 90);
    const bases = {pptx:'Создать презентацию',ppt:'Создать презентацию',docx:'Создать документ',doc:'Создать документ',xlsx:'Создать таблицу',xls:'Создать таблицу',pdf:'Создать PDF',svg:'Создать SVG-инфографику',png:'Создать изображение',csv:'Создать таблицу CSV',json:'Создать файл JSON',html:'Создать HTML-файл',md:'Создать Markdown-файл',txt:'Создать текстовый файл'};
    if (bases[format]) return (bases[format] + (title ? ' · ' + title : '')).slice(0, 90);
    const parent = n && n.parent_message_id ? findNode(state.tree, n.parent_message_id) : null;
    const query = String((parent && parent.content) || (n && n.user_text) || '').toLowerCase();
    if (/(презентац|слайд|pptx|powerpoint|power point)/u.test(query)) return 'Создать презентацию';
    if (/(docx|word|документ|отч[её]т|резюме)/u.test(query)) return 'Создать документ';
    if (/(xlsx|excel|таблиц[ауы]|электронн[а-я ]+таблиц)/u.test(query)) return 'Создать таблицу';
    if (/(изображени|картинк|инфограф|png|svg|постер)/u.test(query)) return 'Создать изображение';
    if (/(pdf)/u.test(query)) return 'Создать PDF';
    return 'Создать файл';
  }

  function deviceRunnerStatusLabel(n) {
    if (!n) return 'Ожидаю статус выполнения…';
    const status = String(n.deviceRunnerStatus || '').trim();
    const known = {completed:'Создание файла завершено.',failed:'Выполнение завершено без успешного результата.','file-created-server':'Файл создан и сохранён в чате.','file-created-local-only':'Файл создан на устройстве; синхронизация не завершена.'};
    if (known[status]) return known[status];
    return status || (n.deviceRunnerFinishedAt ? 'Выполнение завершено.' : 'Создаю файл на устройстве…');
  }

  function updateDeviceRunnerStatusPanel(messageId, n, fallbackMessage) {
    const shell = $('#device-code-shell');
    if (!shell || !shell.classList.contains('open') || !shell.classList.contains('background-status-mode') ||
        String(deviceCodeMessageId || '') !== String(messageId || '')) return;
    const label = n ? deviceRunnerStatusLabel(n) : String(fallbackMessage || 'Ожидаю статус выполнения…');
    const status = $('#device-code-status');
    if (status) status.textContent = label;
    const details = $('#device-code-background-status');
    if (details) {
      details.hidden = false;
      details.textContent = [label, n && n.deviceRunnerLogs ? String(n.deviceRunnerLogs).slice(-30000) : '',
        n && n.deviceRunnerError ? String(n.deviceRunnerError).slice(0, 3000) : ''].filter(Boolean).join('\n\n');
      details.scrollTop = details.scrollHeight;
    }
  }

  function openDeviceRunnerStatus(messageId) {
    const n = findNode(state.tree, messageId);
    const shell = $('#device-code-shell');
    const frame = $('#device-code-frame');
    if (!n || !shell) return;
    deviceCodeMessageId = String(n.id);
    if (frame) frame.srcdoc = '';
    const status = $('#device-code-status');
    if (status) status.textContent = deviceRunnerStatusLabel(n);
    const details = $('#device-code-background-status');
    if (details) {
      details.hidden = false;
      details.textContent = [deviceRunnerStatusLabel(n), n.deviceRunnerLogs ? String(n.deviceRunnerLogs).slice(-30000) : '',
        n.deviceRunnerError ? String(n.deviceRunnerError).slice(0, 3000) : ''].filter(Boolean).join('\n\n');
      details.scrollTop = details.scrollHeight;
    }
    const files = $('#device-code-files');
    if (files) files.hidden = true;
    const errors = $('#device-code-errors');
    if (errors) errors.hidden = true;
    shell.classList.add('background-status-mode', 'open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('device-code-open');
    requestAnimationFrame(() => shell.querySelector('.device-code-panel')?.focus());
  }

  function isAutoFileGenerationRun(run) {
    const code = run && typeof run.code === 'string' ? run.code : '';
    return /(?:^|\r?\n)\s*#\s*AI_CH_AUTO_RUN_FILES\s*(?:\r?\n)?\s*$/i.test(code);
  }

  // Only an explicitly marked file-generation block can run automatically,
  // and it is extracted after the full assistant response has completed.
  function extractAutoDeviceFileRun(answer) {
    const source = String(answer || '');
    const fence = new RegExp('\\x60\\x60\\x60(?:run|python|py)\\b[^\\n]*\\n([\\s\\S]*?)\\x60\\x60\\x60', 'gi');
    let match;
    while ((match = fence.exec(source))) {
      const lines = match[1].split(/\r?\n/);
      const markerIndex = lines.findIndex(line => /^\s*#\s*AI_CH_AUTO_RUN_FILES\s*$/i.test(line));
      if (markerIndex < 0) continue;
      const code = lines.slice(0, markerIndex).join('\n').trim();
      if (!code) continue;
      const visible = (source.slice(0, match.index) + source.slice(match.index + match[0].length))
        .replace(/\n{3,}/g, '\n\n').trim();
      return { code, visible };
    }
    return null;
  }

  function startFallbackFileGenerationInBackground(n) {
    if (!n || n.deviceRunnerStarted) return false;
    const runs = Array.isArray(n.tool_runs) ? n.tool_runs : [];
    const run = runs.slice().reverse().find(item => item && !item.running);
    if (!run) return false;
    const hasFiles = Array.isArray(run.files) && run.files.length > 0;
    let code = '';
    if (run.kind === 'fileplan' && typeof run.device_plan === 'string' && run.device_plan.trim() && !hasFiles) {
      code = deviceCodeForFilePlan(run.device_plan);
    } else if (!hasFiles && isAutoFileGenerationRun(run)) {
      // A finished marked code run must auto-generate too; don't wait for a failed run.
      code = String(run.code || '');
    }
    if (!code.trim()) return false;
    n.deviceRunnerStarted = true;
    n.deviceRunnerStatus = 'Запускаю создание файла на устройстве…';
    n.deviceRunnerError = null;
    n.showActivities = true;
    appendActivity(n, {kind:'status', text:'Автоматически запускаю резервное создание файла на устройстве'});
    openDeviceCodeRunner({lang:'run', code}, n.id, {background:true});
    return true;
  }

  function isDeviceFallbackRun(run) {
    if (!run || typeof run !== 'object' || run.running) return false;
    const failed = run.ok === false || !!run.timed_out;
    if (run.kind === 'fileplan') {
      return typeof run.device_plan === 'string' && !!run.device_plan.trim() &&
        (failed || !(Array.isArray(run.files) && run.files.length));
    }
    const code = typeof run.code === 'string' ? run.code.trim() : '';
    return !!code && (isAutoFileGenerationRun(run) || (failed && !/^План сборки файла\b/u.test(code)));
  }

  function deviceFallbackHtml(n, runs) {
    if (!Array.isArray(runs) || !runs.length || Number(n && n.deviceRunnerFiles) > 0) return '';
    const run = runs.slice().reverse().find(isDeviceFallbackRun);
    if (!run) return '';
    const statusRow = n && n.deviceRunnerStarted
      ? '<div class="device-fallback-status"><span role="status" aria-live="polite">' + escapeHtml(deviceRunnerStatusLabel(n)) +
        '</span><button type="button" data-open-device-status="' + escapeHtml(n.id) + '">Статус выполнения</button></div>'
      : '';
    return '<div class="device-fallback-row"><span class="device-fallback-label" role="status">' +
      escapeHtml(deviceFallbackLabel(n, run)) + '</span><button type="button" class="device-fallback-code-toggle" data-fallback-code-toggle="' +
      escapeHtml(n.id) + '" aria-expanded="false">Показать код</button>' + statusRow + '</div>';
  }

  function activityHtml(n, generating) {
    const items = activityItems(n);
    const runs = Array.isArray(n && n.tool_runs) ? n.tool_runs : [];
    const hasTiming = !!(n && (
      (n.activityElapsedMs !== undefined && n.activityElapsedMs !== null) ||
      (Number.isFinite(Number(n.activityStartedAt)) && Number(n.activityStartedAt) > 0)
    ));
    if (!generating && !items.length && !hasTiming && !runs.length) return '';

    const duration = formatActivityDuration(activityElapsed(n, generating));
    // Keep the live panel quiet: during generation only its current activity is shown.
    // The complete saved history remains available through the separate full-stream view.
    const visibleItems = generating && items.length ? [items[items.length - 1]] : items;
    const rows = visibleItems.map((item, index) => {
      const last = generating && index === visibleItems.length - 1;
      const displayActivityText = item.kind === 'status'
        ? stripActivityEmoji(item.text)
        : item.text;
      const symbol = item.kind === 'action'
        ? icon(ACTIVITY_ICON_NAMES.has(item.icon) ? item.icon : 'sparkle', 'activity-icon')
        : (item.kind === 'status'
          ? activityStatusIconHtml(displayActivityText, n)
          : icon('sparkle', 'activity-status-icon'));
      return '<div class="activity-row' + (last ? ' active' : '') +
        (item.kind === 'status' ? ' status-row' : '') + '">' + symbol +
        '<span class="activity-text">' + escapeHtml(displayActivityText) + '</span>' +
        (last ? thinkAnim() : '') + '</div>';
    }).join('');
    const placeholder = generating && !items.length
      ? '<div class="activity-row active">' + activityStatusIconHtml('Думаю', {statusModelEmoji: '🧠'}) +
        '<span class="activity-text">Думаю</span>' + thinkAnim() + '</div>' : '';
    const expanded = !!n.showActivities;
    const execution = expanded && runs.length
      ? '<div class="activity-execution">' + toolRunsHtml(runs) + '</div>' : '';
    const fullStream = expanded
      ? '<div class="activity-full-row"><button type="button" data-activity-full="' + escapeHtml(n.id) +
        '" title="Открыть отдельное окно полного потока">' + icon('expand') + 'Полный поток</button></div>' : '';
    return '<section class="activity-panel' + (expanded ? ' is-expanded' : '') + '" data-activity-panel="' + escapeHtml(n.id) + '">' +
      '<div class="activity-head"><button type="button" class="activity-summary-button" data-activity-toggle="' +
      escapeHtml(n.id) + '" aria-expanded="' + String(expanded) + '">' +
      '<span data-activity-elapsed="' + escapeHtml(n.id) + '">' +
      (generating ? latestActivityEmojiHtml(n) + ' ' + escapeHtml(latestActivityLabel(n)) : 'Думал ' + duration) + '</span>' +
      icon(expanded ? 'chevron-up' : 'chevron-down') + '</button></div>' +
      '<div class="activity-list"' + (!expanded ? ' hidden' : '') + '>' + fullStream + (rows || placeholder) + execution + '</div>' +
      deviceFallbackHtml(n, runs) +
      '</section>';
  }

  function renderActivityPopup(n) {
    if (!n || !n.id || !window.__aichActivityWindows) return;
    const popup = window.__aichActivityWindows[n.id];
    if (!popup || popup.closed) {
      try { delete window.__aichActivityWindows[n.id]; } catch (e) {}
      return;
    }
    try {
      const log = popup.document.getElementById('activity-log');
      const answer = popup.document.getElementById('stream-answer');
      const scroller = popup.document.getElementById('stream-scroll');
      const stateLabel = popup.document.getElementById('stream-state');
      if (!log || !answer) return;
      const wasNearBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
      log.textContent = activityItems(n).map((item, index) =>
        (index + 1) + '. ' + (item.kind === 'action' ? '[' + (item.icon || 'sparkle') + '] ' : '') +
        (item.kind === 'status' ? stripActivityEmoji(item.text) : item.text)
      ).join('\n') || 'Ожидаю первые статусы…';
      answer.textContent = String(n.publicStream || n.content || n.draft || '');
      if (stateLabel) stateLabel.textContent = n.status === 'completed'
        ? 'Завершено · ' + formatActivityDuration(activityElapsed(n, false))
        : (n.status === 'failed' ? 'Ошибка генерации' : (n.status === 'cancelled' ? 'Остановлено' : 'Генерация продолжается'));
      if (scroller && wasNearBottom) scroller.scrollTop = scroller.scrollHeight;
    } catch (e) { /* a popup may close while a stream event is arriving */ }
  }

  function openActivityStream(id) {
    const live = window.__aichActivityNodes && window.__aichActivityNodes[id];
    const n = (live && live.publicStream) ? live :
      (findNode(state.tree, id) || (state.activeAssistantId ? findNode(state.tree, state.activeAssistantId) : null) || live);
    if (!n) { toast('Поток появится, когда сообщение будет принято сервером.', 'error'); return; }
    const safeWindowName = 'aich-stream-' + String(n.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const popup = window.open('', safeWindowName, 'popup=yes,width=820,height=760,resizable=yes,scrollbars=yes');
    if (!popup) { toast('Браузер заблокировал отдельное окно. Разрешите всплывающие окна для ai-ch.', 'error'); return; }
    window.__aichActivityWindows = window.__aichActivityWindows || Object.create(null);
    window.__aichActivityWindows[n.id] = popup;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Полный поток · AI CH</title><style>' +
      ':root{color-scheme:light;--bg:#ffffff;--fg:#34332f;--muted:#777777;--line:#e5e5e5}' +
      '@media not all{:root{--bg:#20201e;--fg:#ecebe5;--muted:#a7a69f;--line:#41413d}}' +
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,sans-serif}' +
      'header{position:sticky;top:0;background:var(--bg);padding:18px 22px 12px;border-bottom:1px solid var(--line)}' +
      'h1{font-size:18px;font-weight:600;margin:0 0 3px}p{margin:0;color:var(--muted);font-size:12px}' +
      '#stream-scroll{height:calc(100vh - 82px);overflow:auto;padding:18px 22px 30px;scrollbar-width:thin;scrollbar-color:#a8a8a8 transparent}' +
      '#stream-scroll::-webkit-scrollbar{width:8px}#stream-scroll::-webkit-scrollbar-thumb{background:#aaaaaa;border-radius:8px;border:2px solid var(--bg)}' +
      'h2{font-size:13px;color:var(--muted);font-weight:600;margin:0 0 10px}#activity-log{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 26px;padding:0;font:inherit}' +
      '#stream-answer{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0}' +
      '.hint{margin-bottom:20px;color:var(--muted);font-size:12px}.empty{color:var(--muted)}' +
      '</style></head><body><header><h1>Полный поток генерации</h1><p id="stream-state">Подключено</p></header>' +
      '<main id="stream-scroll"><div class="hint">Публичные статусы действий и поток текста ответа. Скрытые внутренние рассуждения модели здесь не раскрываются.</div>' +
      '<h2>Действия и статусы</h2><pre id="activity-log" class="empty">Ожидаю первые статусы…</pre>' +
      '<h2>Поток текста модели</h2><pre id="stream-answer"></pre></main></body></html>');
    popup.document.close();
    try { popup.focus(); } catch (e) {}
    renderActivityPopup(n);
  }

  function askCardHtml(message) {
    if (!message || !message.ask) return '';
    const items = (Array.isArray(message.ask) ? message.ask : [{ question: String(message.ask), options: [] }])
      .slice(0,6).map(item => item && typeof item === 'object' ? item : { question:String(item || ''), options:[] })
      .filter(item => String(item.question || '').trim());
    if (!items.length) return '';
    const saved = Array.isArray(message.askAnswers) ? message.askAnswers : [];
    if (message.askAnswered && message.askCollapsed) {
      const summary = saved.filter(item=>item&&item.value).map(item=>String(item.question||'')+': '+String(item.value||'')).join(' · ').slice(0,360);
      return '<section class="ask-card ask-card-collapsed"><div class="ask-q">'+icon('question')+'<span>Ответ отправлен</span></div>'+
        (summary?'<div class="ask-collapsed-summary">'+escapeHtml(summary)+'</div>':'')+
        '<button type="button" class="chip-btn ask-expand">'+icon('chevron-down')+'Развернуть вопросы</button></section>';
    }
    const questionHtml = items.map((item,index)=>{
      const question=String(item.question||'').slice(0,500);
      const options=Array.isArray(item.options)?item.options.map(value=>String(value||'').trim()).filter(Boolean).slice(0,8):[];
      const savedValue=String((saved[index]||{}).value||'');
      return '<section class="ask-question" data-ask-index="'+index+'"><div class="ask-question-label">'+
        (items.length>1?(index+1)+'. ':'')+escapeHtml(question)+'</div>'+
        (options.length?'<div class="ask-options" role="group" aria-label="'+escapeHtml(question)+'">'+options.map(option=>
          '<button type="button" class="ask-option'+(savedValue===option?' is-selected':'')+'" data-ask-option="'+escapeHtml(option)+
          '" aria-pressed="'+String(savedValue===option)+'">'+escapeHtml(option)+'</button>').join('')+'</div>':'')+
        '<input type="text" class="ask-input" value="'+escapeHtml(savedValue)+'" placeholder="'+
        (options.length?'Или напишите свой вариант…':'Введите свой ответ…')+'" aria-label="'+escapeHtml(question)+'" /></section>';
    }).join('');
    return '<section class="ask-card"><div class="ask-q">'+icon('question')+'<span>'+
      (items.length>1?'Пару уточнений':'Уточним один момент')+'</span></div>'+
      '<div class="ask-intro">Ответьте, чтобы AI CH точнее выполнил запрос.</div>'+questionHtml+
      '<div class="ask-row"><button type="button" class="chip-btn ask-send">'+icon('arrow-up')+'Ответить</button></div></section>';
  }

  function quizResultReport(message) {
    const rows = Array.isArray(message && message.quizResponses) ? message.quizResponses : [];
    const score = (message && message.quizScore) || { correct: 0, total: (message && message.quiz || []).length };
    const results = Array.isArray(message && message.quizResults) ? message.quizResults : [];
    return ['Проверь мой результат теста: ' + Number(score.correct || 0) + ' из ' + Number(score.total || 0) + '.'].concat(
      rows.map((row, index) =>
        (index + 1) + '. ' + String(row.question || '') +
        '\nМой ответ: ' + (Array.isArray(row.values) && row.values.length ? row.values.join(', ') : 'нет ответа') +
        '\nПравильный ответ: ' + (Array.isArray(row.expected) && row.expected.length ? row.expected.join(', ') : 'не задан') +
        '\nРезультат: ' + (results[index] && results[index].correct ? 'верно' : 'неверно')
      )
    ).join('\n\n');
  }

  function sendQuizResultToAI(message) {
    const input = $('#input');
    if (!input || !message || state.streaming || state.sending || state.chatLoading) {
      toast('Результат сохранён. Отправьте его в чат, когда текущий ответ завершится.', 'info');
      return false;
    }
    input.value = quizResultReport(message);
    autoGrow();
    message.quizResultSent = true;
    message.quizCollapsed = true;
    renderMessageInPlace(message.id);
    void sendCurrent();
    return true;
  }

  function quizCardHtml(message) {
    if (!message || !Array.isArray(message.quiz) || !message.quiz.length) return '';
    const items=message.quiz.slice(0,20), submitted=!!message.quizSubmitted, collapsed=!!message.quizCollapsed;
    const score=message.quizScore||{correct:0,total:items.length};
    const heading=submitted?'Тест завершён · '+Number(score.correct||0)+'/'+Number(score.total||items.length):'Проверьте себя';
    const toggle=collapsed?'expand':'collapse';
    const header='<header class="quiz-head"><div class="quiz-heading-copy"><strong>'+escapeHtml(heading)+'</strong><span>'+
      items.length+(items.length===1?' вопрос':items.length<5?' вопроса':' вопросов')+'</span></div>'+
      '<button type="button" class="quiz-toggle" data-quiz-toggle="'+toggle+'" aria-expanded="'+String(!collapsed)+'">'+
      icon(collapsed?'chevron-down':'chevron-up')+'<span>'+(collapsed?'Развернуть тест':'Свернуть')+'</span></button></header>';
    if (collapsed) return '<section class="quiz-card is-collapsed">'+header+'<p class="quiz-collapsed-note">'+
      (submitted?'Ответы проверены. Результат можно открыть в любой момент.':'Тест свёрнут, выбранные варианты сохранены.')+'</p></section>';
    const chosen=Array.isArray(message.quizAnswers)?message.quizAnswers:[], customAnswers=Array.isArray(message.quizCustom)?message.quizCustom:[];
    const questionHtml=items.map((item,index)=>{
      const q=item&&typeof item==='object'?item:{question:String(item||''),options:[]};
      const question=String(q.question||'').slice(0,500), options=Array.isArray(q.options)?q.options.map(String).slice(0,12):[];
      const selected=Array.isArray(chosen[index])?chosen[index]:[], correct=Array.isArray(q.correct)?q.correct:(q.correct?[q.correct]:[]);
      const result=Array.isArray(message.quizResults)?message.quizResults[index]:null;
      const resultClass=submitted&&result?(result.correct?' is-correct':' is-incorrect'):'';
      const norm=value=>String(value||'').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ');
      const optionsHtml=options.length?'<div class="quiz-options" role="group" aria-label="'+escapeHtml(question)+'">'+options.map(option=>{
        const picked=selected.includes(option), isCorrect=submitted&&correct.some(value=>norm(value)===norm(option)), isWrong=submitted&&picked&&!isCorrect;
        return '<button type="button" class="quiz-option'+(picked?' is-selected':'')+(isCorrect?' is-answer-correct':'')+(isWrong?' is-answer-wrong':'')+
          '" data-quiz-option="'+escapeHtml(option)+'" data-quiz-index="'+index+'" data-quiz-multiple="'+String(!!q.multiple)+
          '" aria-pressed="'+String(picked)+'"'+(submitted?' disabled':'')+'><span class="quiz-choice-mark" aria-hidden="true"></span>'+
          '<span class="quiz-choice-label">'+escapeHtml(option)+'</span></button>';
      }).join('')+'</div>'+(q.multiple&&!submitted?'<div class="quiz-hint">Можно выбрать несколько вариантов.</div>':''):'';
      const feedback=submitted&&result?'<div class="quiz-feedback '+(result.correct?'is-correct':'is-incorrect')+'"><strong>'+
        (result.correct?'Верно':'Не совсем')+'</strong>'+(!result.correct&&correct.length?'<span>Правильный ответ: '+escapeHtml(correct.join(', '))+'</span>':'')+
        (q.explanation?'<p>'+escapeHtml(String(q.explanation).slice(0,500))+'</p>':'')+'</div>':'';
      return '<section class="quiz-question'+resultClass+'" data-quiz-question="'+index+'"><div class="quiz-question-title"><span>'+
        (index+1)+'</span><strong>'+escapeHtml(question)+'</strong></div>'+optionsHtml+
        '<label class="quiz-custom-wrap"><span>'+(options.length?'Или свой ответ':'Ваш ответ')+'</span><input type="text" class="quiz-custom-answer" data-quiz-custom="'+index+
        '" value="'+escapeHtml(String(customAnswers[index]||''))+'" placeholder="Введите свой вариант…" aria-label="Свой ответ на вопрос '+(index+1)+'"'+
        (submitted?' disabled':'')+' /></label>'+feedback+'</section>';
    }).join('');
    const summary=submitted?'<div class="quiz-result-summary">'+icon('check-circle')+'<span>Правильных ответов: <strong>'+
      Number(score.correct||0)+' из '+Number(score.total||items.length)+'</strong></span></div>':'';
    const footer=submitted?(message.quizResultSent?'<span class="quiz-sent-note">Результат отправлен в чат</span>':
      '<button type="button" class="chip-btn quiz-send-result" data-quiz-send-result>'+icon('arrow-up')+'Отправить результат в чат</button>'):
      '<button type="button" class="chip-btn quiz-submit" data-quiz-submit>'+icon('check-circle')+'Проверить ответы</button>';
    return '<section class="quiz-card">'+header+'<div class="quiz-body">'+questionHtml+'</div>'+summary+'<footer class="quiz-footer">'+footer+'</footer></section>';
  }

  function msgHtml(entry, isLast) {
    const n = entry.node;
    const isUser = n.role === 'user';
    const generating = !isUser && (n.status === 'queued' || n.status === 'processing');
    let inner;
    if (isUser) {
      inner = attsHtml(n.attachments) +
        '<div class="user-message-row">' +
          '<button class="user-copy-btn" data-mact="copy-user" data-icon-only="1" data-id="' + escapeHtml(n.id) +
            '" title="Копировать сообщение" aria-label="Копировать сообщение">' + icon('copy') + '</button>' +
          '<div class="bubble">' + escapeHtml(n.content) + '</div>' +
        '</div>';
    } else {
      const failed = n.status === 'failed';
      const hasThink = !!(n.thinking && String(n.thinking).trim());
      const draft = n.draft || '';

      if (generating) {
        // Render the accumulated draft while the model is still responding.
        // renderMarkdown also recognises complete code fences, math and UI blocks.
        const liveDraft = String(draft || n.publicStream || '');
        inner = activityHtml(n, true) + deepResearchHtml(n) + messageFilesHtml(n) +
          (liveDraft.trim()
            ? '<div class="content md streaming-answer" aria-live="polite">' + renderMarkdown(liveDraft) + '</div>'
            : '');
      } else if (failed) {
        inner = activityHtml(n, false) + deepResearchHtml(n) + messageFilesHtml(n) +
          '<div class="content md" style="color:var(--danger)">Ошибка: ' +
          escapeHtml(n.error || 'запрос не прошёл') + '</div>';
      } else {
        const raw = String(n.content || '');
        const truncated = raw.length > FULL_RENDER_LIMIT && !n.showFull;
        const body = truncated ? raw.slice(0, FULL_RENDER_LIMIT) : raw;
        inner = activityHtml(n, false) + deepResearchHtml(n) + messageFilesHtml(n) + '<div class="content md">' + renderMarkdown(body) + imageResultsHtml(n.sources) + '</div>' +
          (truncated
            ? '<div class="more-note">Показано ' + FULL_RENDER_LIMIT.toLocaleString('ru-RU') +
              ' из ' + raw.length.toLocaleString('ru-RU') + ' символов — ' +
              'чтобы не подвешивать браузер. <button data-mact="expand" data-id="' + escapeHtml(n.id) +
              '">Показать полностью</button></div>'
            : '');
      }
    }

    let meta = '';
    if (!isUser && !state.readonly) {
      const generating = n.status === 'queued' || n.status === 'processing';
      const parts = [];
      if (n.status === 'cancelled') parts.push('<span class="status">остановлено</span>');
      if (generating) {
        if (n.showActivities) parts.push('<button data-mact="stop" data-id="' + escapeHtml(n.id) + '">' + icon('stop') + 'Остановить</button>');
      } else {
        if (n.content) {
          parts.push('<button class="message-action-labeled" data-mact="copy" data-id="' + escapeHtml(n.id) +
            '" title="Копировать ответ" aria-label="Копировать ответ">' + icon('copy') + '<span>Копировать</span></button>');
          parts.push('<button class="message-action-labeled" data-mact="save" data-id="' + escapeHtml(n.id) +
            '" title="Сохранить ответ" aria-label="Сохранить ответ">' + icon('download') + '<span>Сохранить</span></button>');
          if (n.status === 'completed') {
            parts.push('<button class="message-action-labeled listen-answer-action" data-mact="listen-answer" data-id="' +
              escapeHtml(n.id) + '" title="Слушать ответ" aria-label="Слушать ответ">' + icon('audio') +
              '<span>Слушать ответ</span></button>');
          }
          if (n.memories && n.memories.length) {
            parts.push('<button class="icon-only-action" data-icon-only="1" data-mact="memory" data-id="' + escapeHtml(n.id) +
              '" title="Что записано в память" aria-label="Память">' + icon('sparkle') + '</button>');
          }
        }
        if (n.sources && n.sources.length) {
          parts.push('<button class="icon-only-action" data-icon-only="1" data-mact="sources" data-id="' + escapeHtml(n.id) +
            '" title="Источники из интернета" aria-label="Источники из интернета">' +
            icon('globe') + '<b class="cnt">' + n.sources.length + '</b></button>');
        }
      }
      meta = '<div class="meta">' + parts.join('') + '</div>';
    }

    let memLine = '';
    if (!isUser && n.memories && n.memories.length && !generating) {
      memLine = '<div class="mem-line" data-memline="' + n.id + '">' + icon('sparkle') +
        '<span>Запомнил: ' + escapeHtml(n.memories.join('; ').slice(0, 140)) + '</span></div>';
    }

    const askCard = askCardHtml(n);
    const quizCard = quizCardHtml(n);

    const hasSpeechActions = !isUser && !state.readonly &&
      n.status === 'completed' && String(n.content || '').trim();
    const actionsRow = !isUser && !state.readonly && (meta || hasSpeechActions)
      ? '<div class="msg-actions-row">' + meta + '</div>' : '';

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'AI CH') + '</div>' +
      inner + askCard + quizCard + actionsRow + memLine + '</div>';
  }

  function audioQuotaSnapshot() {
    const limitsWindow = state.limits && state.limits.window;
    if (!limitsWindow || limitsWindow.hours == null) {
      return { label: '', remaining: null, hours: null };
    }
    const hours = Math.max(1, Number(limitsWindow.hours) || 5);
    const used = Math.max(0, Number(limitsWindow.audio_generations) || 0);
    if (limitsWindow.audio_limit == null) {
      return { label: 'без лимита на ' + hours + ' ч.', remaining: null, hours };
    }
    const limit = Number(limitsWindow.audio_limit);
    if (!Number.isFinite(limit)) {
      return { label: 'лимит недоступен', remaining: null, hours };
    }
    const remaining = Math.max(0, Math.floor(limit - used));
    return {
      label: remaining > 0 ? 'осталось ' + remaining + ' на ' + hours + ' ч.' : 'лимит исчерпан на ' + hours + ' ч.',
      remaining,
      hours,
    };
  }

  function readableTextStatusLabel(messageId) {
    const record = state.readableText[messageId];
    if (!record) return 'Проверяю читабельный текст…';
    if (record.status === 'ready') return 'Текст готов';
    if (record.status === 'missing') return 'Текст ещё не подготовлен.';
    if (record.status === 'failed') {
      const detail = String(record.error || 'ошибка сервиса').trim();
      return 'Не удалось создать читабельный текст: ' + detail.slice(0, 260);
    }
    return 'Создаю читабельный текст…';
  }

  function readableTextStatusHtml(n) {
    const record = state.readableText[n.id];
    const cls = record && record.status === 'ready' ? ' is-ready' :
      record && record.status === 'failed' ? ' is-error' : '';
    return '<div class="readable-text-status-wrap" data-readable-status="' + escapeHtml(n.id) + '">' +
      '<span class="readable-text-status' + cls + '" role="status" aria-live="polite">' +
      escapeHtml(readableTextStatusLabel(n.id)) + '</span></div>';
  }

  function updateReadableTextUi(messageId) {
    const status = $$('[data-readable-status]').find(el => el.dataset.readableStatus === String(messageId));
    const record = state.readableText[messageId];
    if (status) {
      const label = $('.readable-text-status', status);
      if (label) {
        label.textContent = readableTextStatusLabel(messageId);
        label.classList.toggle('is-ready', !!(record && record.status === 'ready'));
        label.classList.toggle('is-error', !!(record && record.status === 'failed'));
      }
    }
    updateAudioControl(messageId);
    updateDeviceAudioControl(messageId);
    updateSpeechPlayerUi(messageId);
  }

  function updateSpeechPlayerUi(messageId) {
    const id = String(messageId || state.audioMessageId || pendingDeviceSpeechMessageId || '');
    if (!id) return;
    const record = state.readableText[id];
    const textStatus = readableTextStatusLabel(id);
    const aiStatus = $('#audio-player-status-text');
    const deviceStatus = $('#device-audio-ready-text');
    if (aiStatus && String(state.audioMessageId || '') === id) {
      aiStatus.textContent = state.audioErrors[id] && record && record.status === 'ready'
        ? 'Текст готов. Ошибка ИИ-аудио: ' + state.audioErrors[id]
        : textStatus;
    }
    if (deviceStatus && (
      String(deviceSpeechState.messageId || '') === id ||
      String(pendingDeviceSpeechMessageId || '') === id ||
      String(state.audioMessageId || '') === id
    )) deviceStatus.textContent = textStatus;

    const ready = !!state.audioReady[id];
    const pending = !!state.audioPending[id] || !!state.audioRequestInFlight[id] ||
      String(state.audioBusyMessageId || '') === id;
    const otherBusy = !!state.audioBusyMessageId && String(state.audioBusyMessageId) !== id;
    const quota = audioQuotaSnapshot();
    const generate = $('#audio-player-generate-btn');
    const playback = $('#audio-player-playback');
    if (generate && String(state.audioMessageId || '') === id) {
      generate.hidden = ready;
      generate.disabled = pending || otherBusy || quota.remaining === 0;
      generate.textContent = pending
        ? (record && record.status === 'ready' ? 'Создаю ИИ-аудио…' : 'Ожидаю готовность текста…')
        : (quota.remaining === 0 ? 'Лимит озвучки исчерпан' : 'Озвучить ИИ');
    }
    if (playback && String(state.audioMessageId || '') === id) playback.hidden = !ready;

    const audio = $('#audio-player-source');
    if (audio && String(state.audioMessageId || '') === id) {
      const wantedSrc = '/api/messages/' + encodeURIComponent(id) + '/audio/file';
      if (ready && audio.getAttribute('src') !== wantedSrc) {
        audio.src = wantedSrc;
        audio.load();
      } else if (!ready && audio.getAttribute('src')) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    }
  }

  function deviceAudioControlHtml(n) {
    const id = escapeHtml(n.id);
    return '<div class="device-audio-wrap" data-device-audio-control="' + id + '">' +
      '<button class="speech-action-button device-audio-button" data-mact="device-audio" data-id="' +
      id + '" title="Слушать читабельную версию ответа на устройстве">' +
      icon('audio') + '<span class="speech-button-copy"><b>Слушать ответ</b>' +
      '<small>(создаёт ваше устройство)</small></span></button></div>';
  }

  function audioControlHtml(n) {
    const id = escapeHtml(n.id);
    const quota = audioQuotaSnapshot();
    const quotaLabel = quota.label ? '(' + quota.label + ')' : 'создать голосовую версию';
    const readyLabel = 'Аудио готово' + (quota.label ? ' · ' + quotaLabel : ' · слушать');
    if (state.audioPending[n.id]) {
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="speech-action-button answer-audio-generate is-loading" data-mact="audio-pending" data-id="' + id + '" disabled>' +
        '<span class="audio-loading-ring"></span><span class="speech-button-copy"><b>Озвучка ИИ</b><small>Создаю аудио…</small></span></button></div>';
    }
    if (state.audioReady[n.id]) {
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="speech-action-button answer-audio-generate is-ready" data-mact="play-audio" data-id="' + id + '" title="Слушать готовую ИИ-озвучку">' +
        icon('play') + '<span class="speech-button-copy"><b>Озвучка ИИ</b><small>' + escapeHtml(readyLabel) + '</small></span></button></div>';
    }
    if (state.audioBusyMessageId) {
      const sameMessage = String(state.audioBusyMessageId) === String(n.id);
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="speech-action-button answer-audio-generate is-loading" data-mact="audio-pending" data-id="' + id + '" disabled>' +
        '<span class="audio-loading-ring"></span><span class="speech-button-copy"><b>Озвучка ИИ</b><small>' +
        (sameMessage ? 'Создаю аудио…' : 'Другая озвучка уже создаётся…') + '</small></span></button></div>';
    }
    if (quota.remaining === 0) {
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="speech-action-button answer-audio-generate is-loading" data-mact="audio-pending" data-id="' + id + '" disabled>' +
        icon('audio') + '<span class="speech-button-copy"><b>Озвучка ИИ</b><small>' + escapeHtml(quotaLabel) + '</small></span></button></div>';
    }
    return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
      '<button class="speech-action-button answer-audio-generate" data-mact="generate-audio" data-id="' + id + '" title="Создать ИИ-озвучку">' +
      icon('audio') + '<span class="speech-button-copy"><b>Озвучка ИИ</b><small>' + escapeHtml(quotaLabel) + '</small></span></button></div>';
  }

  function updateAudioControl(messageId) {
    const wrapper = $$('[data-audio-control]').find(el => el.dataset.audioControl === String(messageId));
    const entry = findNode(state.tree, messageId);
    if (wrapper && entry) wrapper.outerHTML = audioControlHtml(entry);
  }

  function updateDeviceAudioControl(messageId) {
    const wrapper = $$('[data-device-audio-control]').find(el => el.dataset.deviceAudioControl === String(messageId));
    const entry = findNode(state.tree, messageId);
    if (wrapper && entry) wrapper.outerHTML = deviceAudioControlHtml(entry);
  }

  function updateAllAudioControls() {
    allMessages(state.tree).forEach(entry => {
      const n = entry && entry.node;
      if (n && n.role === 'assistant' && n.status === 'completed' && String(n.content || '').trim()) {
        updateAudioControl(n.id);
      }
    });
  }

  function applyAudioStatus(messageId, result) {
    if (!result) return;
    if (result.error) state.audioErrors[messageId] = String(result.error).slice(0, 500);
    else if (result.ready || result.generating || result.busy) delete state.audioErrors[messageId];
    const previousBusyId = state.audioBusyMessageId;
    if (result.busy && result.generating_message_id) {
      state.audioBusyMessageId = String(result.generating_message_id);
    } else if (!result.busy && !(previousBusyId && state.audioRequestInFlight[previousBusyId])) {
      state.audioBusyMessageId = null;
      if (previousBusyId && String(previousBusyId) !== String(messageId) && !state.audioRequestInFlight[previousBusyId]) {
        state.audioPending[previousBusyId] = false;
        state.audioStatusRequested.delete(previousBusyId);
        updateAudioControl(previousBusyId);
      }
    }

    if (result.ready) {
      state.audioReady[messageId] = true;
      state.audioPending[messageId] = false;
    } else if (result.generating) {
      state.audioPending[messageId] = true;
    } else if (!state.audioRequestInFlight[messageId]) {
      state.audioPending[messageId] = false;
    }

    if (previousBusyId !== state.audioBusyMessageId) updateAllAudioControls();
    updateAudioControl(messageId);
    updateSpeechPlayerUi(messageId);
  }

  async function refreshAudioStatus(messageId) {
    try {
      const result = await api.get('/api/messages/' + encodeURIComponent(messageId) + '/audio/status');
      applyAudioStatus(messageId, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  function startAudioStatusPolling() {
    if (state.readonly || state.audioStatusPollTimer) return;
    state.audioStatusPollTimer = window.setInterval(async () => {
      if (state.audioStatusPollRunning || state.readonly) return;
      const entries = allMessages(state.tree);
      const messages = entries
        .map(entry => entry && entry.node)
        .filter(n => n && n.role === 'assistant' && n.status === 'completed' && String(n.content || '').trim());
      if (!messages.length) {
        window.clearInterval(state.audioStatusPollTimer);
        state.audioStatusPollTimer = null;
        return;
      }
      const active = state.audioBusyMessageId &&
        messages.find(n => String(n.id) === String(state.audioBusyMessageId));
      const monitor = active || messages[messages.length - 1];
      state.audioStatusPollRunning = true;
      try {
        await refreshAudioStatus(monitor.id);
      } finally {
        state.audioStatusPollRunning = false;
      }
    }, 2500);
  }

  function hydrateAudioStatuses(entries) {
    if (state.readonly) return;
    if (state.audioStatusChatId !== state.currentChatId) {
      state.audioStatusRequested.clear();
      state.audioStatusChatId = state.currentChatId;
    }
    let hasCompletedAnswer = false;
    entries.forEach(entry => {
      const n = entry.node;
      if (!n || n.role !== 'assistant' || n.status !== 'completed' || !String(n.content || '').trim()) return;
      hasCompletedAnswer = true;
      if (state.audioStatusRequested.has(n.id) && !state.audioPending[n.id] &&
          String(state.audioBusyMessageId || '') !== String(n.id)) return;
      state.audioStatusRequested.add(n.id);
      refreshAudioStatus(n.id);
    });
    // Poll the server while this chat has answers so generation started on
    // another device appears here too, and its completion is reflected.
    if (hasCompletedAnswer) startAudioStatusPolling();
  }

  function startPendingDeviceSpeechIfReady(messageId) {
    const id = String(messageId || '');
    const record = state.readableText[id];
    const shell = $('#device-audio-player-shell');
    if (!id || String(pendingDeviceSpeechMessageId || '') !== id ||
        !record || record.status !== 'ready' || !String(record.text || '').trim() ||
        !shell || !shell.classList.contains('open')) return;
    pendingDeviceSpeechMessageId = null;
    startDeviceSpeech(id);
  }

  async function refreshReadableTextStatus(messageId) {
    try {
      const result = await api.get('/api/messages/' + encodeURIComponent(messageId) + '/readable-text');
      if (!result || !result.status) return null;
      const current = state.readableText[messageId];
      if (result.status === 'missing' && (
        state.readableTextRequestInFlight[messageId] ||
        (current && (current.status === 'ready' || current.status === 'generating'))
      )) return current;
      state.readableText[messageId] = result;
      updateReadableTextUi(messageId);
      if (result.status === 'generating') startReadableTextStatusPolling();
      if (result.status === 'ready') startPendingDeviceSpeechIfReady(messageId);
      return result;
    } catch (e) {
      return null;
    }
  }

  function startReadableTextStatusPolling() {
    if (state.readonly || state.readableTextStatusPollTimer) return;
    state.readableTextStatusPollTimer = window.setInterval(async () => {
      if (state.readableTextStatusPollRunning || state.readonly) return;
      const pending = allMessages(state.tree)
        .map(entry => entry && entry.node)
        .filter(n => n && n.role === 'assistant' && n.status === 'completed' &&
          state.readableText[n.id] && state.readableText[n.id].status === 'generating');
      if (!pending.length) {
        window.clearInterval(state.readableTextStatusPollTimer);
        state.readableTextStatusPollTimer = null;
        return;
      }
      state.readableTextStatusPollRunning = true;
      try {
        await Promise.all(pending.slice(-8).map(n => refreshReadableTextStatus(n.id)));
      } finally {
        state.readableTextStatusPollRunning = false;
      }
    }, 2500);
  }

  function hydrateReadableTextStatuses(entries) {
    if (state.readonly) return;
    if (state.readableTextChatId !== state.currentChatId) {
      state.readableTextStatusRequested.clear();
      state.readableTextChatId = state.currentChatId;
    }

    const completed = entries
      .map(entry => entry && entry.node)
      .filter(n => n && n.role === 'assistant' && n.status === 'completed' && String(n.content || '').trim());
    const latest = completed.reduce((best, node) => {
      if (!best) return node;
      return String(node.created_at || '') >= String(best.created_at || '') ? node : best;
    }, null);
    const latestId = latest ? String(latest.id) : null;

    completed.forEach(n => {
      if (state.readableTextStatusRequested.has(n.id)) return;
      state.readableTextStatusRequested.add(n.id);

      // Keep older answers available on demand; prepare the newest completed answer
      // immediately so both audio buttons share the same readable text.
      refreshReadableTextStatus(n.id).then(record => {
        if (!record || String(n.id) !== latestId || record.status !== 'missing') return;
        return generateReadableText(n.id, false);
      }).catch(() => { /* status text below the answer reports the eventual failure */ });
    });

    const hasPending = completed.some(n =>
      state.readableText[n.id] && state.readableText[n.id].status === 'generating'
    );
    if (hasPending) startReadableTextStatusPolling();
  }

  async function generateReadableText(messageId, force) {
    const current = state.readableText[messageId];
    if (current && current.status === 'ready' && String(current.text || '').trim()) return current;
    if (state.readableTextRequestInFlight[messageId]) return current || null;
    if (current && current.status === 'generating' && !force) return current;

    state.readableText[messageId] = { status: 'generating', text: null, error: null };
    state.readableTextRequestInFlight[messageId] = true;
    updateReadableTextUi(messageId);
    startReadableTextStatusPolling();
    try {
      const result = await api.post('/api/messages/' + encodeURIComponent(messageId) + '/readable-text', {});
      state.readableText[messageId] = result && result.status ? result : { status: 'generating', text: null, error: null };
      updateReadableTextUi(messageId);
      if (state.readableText[messageId].status === 'generating') startReadableTextStatusPolling();
      if (state.readableText[messageId].status === 'ready') startPendingDeviceSpeechIfReady(messageId);
      return state.readableText[messageId];
    } catch (err) {
      let latest = null;
      try {
        // Read server state directly here: refreshReadableTextStatus intentionally
        // ignores a "missing" response while a local POST is still in flight.
        latest = await api.get('/api/messages/' + encodeURIComponent(messageId) + '/readable-text');
      } catch (statusError) {
        // Preserve the original POST failure below if status lookup also fails.
      }
      if (latest && latest.status && latest.status !== 'missing') {
        state.readableText[messageId] = latest;
        updateReadableTextUi(messageId);
        if (latest.status === 'generating') startReadableTextStatusPolling();
        if (latest.status === 'ready') startPendingDeviceSpeechIfReady(messageId);
        return latest;
      }
      state.readableText[messageId] = {
        status: 'failed',
        text: null,
        error: usefulErrorMessage(err, 'не удалось связаться с сервером'),
      };
      updateReadableTextUi(messageId);
      return state.readableText[messageId];
    } finally {
      state.readableTextRequestInFlight[messageId] = false;
    }
  }

  function ensureReadableTextBeforePlayback(messageId) {
    const record = state.readableText[messageId];
    if (record && record.status === 'ready' && String(record.text || '').trim()) return true;
    if (!record || record.status === 'missing' || record.status === 'failed') {
      generateReadableText(messageId, true);
      toast(record && record.status === 'failed'
        ? 'Повторно создаю читабельный текст. Статус появится под ответом.'
        : 'Создаю читабельный текст перед прослушиванием.');
    } else {
      toast('Читабельный текст ещё создаётся. Статус виден под ответом.');
    }
    return false;
  }

  async function generateAnswerAudio(messageId) {
    const node = findNode(state.tree, messageId);
    if (!node || node.role !== 'assistant' || node.status !== 'completed' || !String(node.content || '').trim()) {
      toast('Озвучить можно только готовый ответ.', 'error');
      return;
    }
    if (state.audioReady[messageId]) {
      updateSpeechPlayerUi(messageId);
      return;
    }
    if (state.audioPending[messageId] || state.audioRequestInFlight[messageId]) return;
    if (state.audioBusyMessageId && String(state.audioBusyMessageId) !== String(messageId)) {
      toast('Уже создаётся другая озвучка. Дождитесь её завершения.', 'error');
      return;
    }

    state.audioErrors[messageId] = '';
    state.audioRequestInFlight[messageId] = true;
    state.audioPending[messageId] = true;
    state.audioBusyMessageId = String(messageId);
    updateAllAudioControls();
    updateSpeechPlayerUi(messageId);
    startAudioStatusPolling();
    try {
      // The server queues text preparation and TTS independently of this page.
      const result = await api.post('/api/messages/' + encodeURIComponent(messageId) + '/audio', {});
      state.audioRequestInFlight[messageId] = false;
      state.audioStatusRequested.add(messageId);
      if (result && result.ready) {
        state.audioReady[messageId] = true;
        state.audioPending[messageId] = false;
        state.audioBusyMessageId = null;
        delete state.audioErrors[messageId];
        updateAllAudioControls();
        updateSpeechPlayerUi(messageId);
        await loadLimits();
        toast('ИИ-озвучка готова. Нажмите ▶ в плеере.');
      } else {
        state.audioPending[messageId] = true;
        state.audioBusyMessageId = String(messageId);
        updateAllAudioControls();
        updateSpeechPlayerUi(messageId);
        startAudioStatusPolling();
        await refreshAudioStatus(messageId);
        await loadLimits();
        toast('ИИ-озвучка запущена на сервере. Можно закрыть сайт — подготовка продолжится.');
      }
    } catch (err) {
      state.audioRequestInFlight[messageId] = false;
      const status = await refreshAudioStatus(messageId);
      if (status && status.ready) {
        state.audioReady[messageId] = true;
        state.audioPending[messageId] = false;
        state.audioBusyMessageId = null;
        updateSpeechPlayerUi(messageId);
      } else if (status && status.generating) {
        state.audioPending[messageId] = true;
        state.audioBusyMessageId = String(messageId);
        updateSpeechPlayerUi(messageId);
      } else {
        state.audioPending[messageId] = false;
        if (String(state.audioBusyMessageId) === String(messageId)) state.audioBusyMessageId = null;
        if (status && status.error) state.audioErrors[messageId] = String(status.error);
        updateSpeechPlayerUi(messageId);
        toast('Не удалось запустить озвучку: ' + (err.message || 'ошибка сервера'), 'error');
      }
      updateAllAudioControls();
      await loadLimits();
    }
  }

  function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateAudioPlayerControls() {
    const audio = $('#audio-player-source');
    const play = $('#audio-play-toggle');
    if (!audio || !play) return;
    play.innerHTML = icon(audio.paused ? 'play' : 'pause');
    play.title = audio.paused ? 'Воспроизвести' : 'Пауза';
    play.setAttribute('aria-label', play.title);
    const progress = $('#audio-progress');
    if (progress) {
      const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      progress.value = max ? Math.round((audio.currentTime / max) * 1000) : 0;
      progress.disabled = !max;
    }
    const current = $('#audio-current-time'), total = $('#audio-total-time');
    if (current) current.textContent = formatAudioTime(audio.currentTime || 0);
    if (total) total.textContent = formatAudioTime(audio.duration || 0);
  }

  function openAudioPlayer(messageId, autoplay) {
    const n = findNode(state.tree, messageId);
    if (!n || n.role !== 'assistant' || !String(n.content || '').trim()) return;
    const deviceShell = $('#device-audio-player-shell');
    if (deviceShell && deviceShell.classList.contains('open')) closeDeviceSpeechPlayer();
    const shell = $('#audio-player-shell'), audio = $('#audio-player-source');
    if (!shell || !audio) return;
    state.audioMessageId = String(messageId);
    const chat = state.chats.find(c => c.id === state.currentChatId);
    const playerTitle = (chat && chat.title) || 'Ответ';
    $('#audio-player-title').textContent = playerTitle;
    if (navigator.mediaSession && typeof window.MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: playerTitle, artist: 'ai-ch', album: 'Озвучка ответов',
        });
      } catch (e) { /* media metadata is optional */ }
    }
    installFileAudioMediaSessionHandlers();
    audio.pause();
    if (state.audioReady[messageId]) {
      audio.src = '/api/messages/' + encodeURIComponent(messageId) + '/audio/file';
    } else {
      audio.removeAttribute('src');
    }
    audio.playbackRate = Number($('#audio-player-rate') && $('#audio-player-rate').value) || 1;
    audio.load();
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('audio-player-open');
    updateAudioPlayerControls();
    updateSpeechPlayerUi(messageId);
    refreshReadableTextStatus(messageId).then(record => {
      if (!record) return null;
      if (record.status === 'missing' || record.status === 'failed') {
        return generateReadableText(messageId, true);
      }
      return record;
    }).then(() => updateSpeechPlayerUi(messageId)).catch(() => {});
    if (autoplay && state.audioReady[messageId]) {
      audio.play().catch(() => toast('Нажмите воспроизведение, чтобы запустить аудио.', 'error'));
    }
    requestAnimationFrame(() => $('#audio-close-btn')?.focus());
  }

  function closeAudioPlayer() {
    const shell = $('#audio-player-shell'), audio = $('#audio-player-source');
    if (audio) audio.pause();
    if (shell) {
      shell.classList.remove('open');
      shell.setAttribute('aria-hidden', 'true');
    }
    // Avoid stale controls on the lock screen after dismissing the player.
    clearMediaSessionActions();
    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        if (typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState();
        }
      } catch (e) { /* media-session cleanup is optional */ }
    }
    document.body.classList.remove('audio-player-open');
  }

  function readableSpeechText(source) {
    let text = String(source || '');
    text = text.replace(/\x60{3}[\s\S]*?\x60{3}/g, ' (блок кода пропущен) ');
    text = text.replace(/\x60([^\x60]+)\x60/g, '$1');
    text = text.replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, '$1');
    text = text.replace(/https?:\/\/[^\s)]+/g, ' (ссылка) ');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    text = text.replace(/^\s*>\s?/gm, '');
    text = text.replace(/^\s*[-*+]\s+/gm, '');
    text = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
    text = text.replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1');
    text = text.replace(/^\s*\|?[- :|]{3,}\|?\s*$/gm, '');
    text = text.replace(/[|*_~#]/g, ' ');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '. ');
    text = text.replace(/\n/g, ' ').replace(/\s+([,.!?;:])/g, '$1');
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  function updateDeviceSpeechControls() {
    const total = deviceSpeechState.words.length;
    const startWord = deviceSpeechState.index * DEVICE_SPEECH_CHUNK_SIZE;
    const endWord = Math.min(total, startWord + DEVICE_SPEECH_CHUNK_SIZE);
    const current = $('#device-audio-current-text');
    if (current) current.textContent = deviceSpeechState.chunks[deviceSpeechState.index] || '';
    const wordPosition = $('#device-audio-word-position');
    if (wordPosition) wordPosition.textContent = total ? 'Слова ' + (startWord + 1) + '–' + endWord + ' из ' + total : 'Слова 0–0 из 0';
    const chunkPosition = $('#device-audio-chunk-position');
    if (chunkPosition) chunkPosition.textContent = 'Фрагмент ' + (deviceSpeechState.chunks.length ? deviceSpeechState.index + 1 : 0) + '/' + deviceSpeechState.chunks.length;
    const fill = $('#device-audio-progress-fill');
    if (fill) fill.style.width = (total ? Math.round((endWord / total) * 100) : 0) + '%';
    const button = $('#device-audio-play-toggle');
    if (button) {
      button.innerHTML = icon(deviceSpeechState.playing ? 'pause' : 'play');
      button.title = deviceSpeechState.playing ? 'Приостановить озвучивание' :
        (deviceSpeechState.pending ? 'Запускаю озвучку…' : 'Воспроизвести / повторить запуск');
      button.setAttribute('aria-label', button.title);
      button.disabled = !deviceSpeechState.active;
    }
    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.playbackState = deviceSpeechState.playing ? 'playing' : 'paused';
        if (typeof navigator.mediaSession.setPositionState === 'function' && deviceSpeechState.chunks.length) {
          navigator.mediaSession.setPositionState({
            duration: deviceSpeechState.chunks.length,
            position: Math.min(deviceSpeechState.index, deviceSpeechState.chunks.length),
            playbackRate: deviceSpeechState.rate,
          });
        }
      } catch (e) { /* optional in Safari and some Android browsers */ }
    }
  }

  function installFileAudioMediaSessionHandlers() {
    const audio = $('#audio-player-source');
    if (!audio || !navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') return;
    const seek = (offset) => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      audio.currentTime = Math.max(0, Math.min(duration, (Number(audio.currentTime) || 0) + offset));
      updateAudioPlayerControls();
    };
    const handlers = {
      play: () => audio.play().catch(() => {}),
      pause: () => audio.pause(),
      previoustrack: () => seek(-10),
      nexttrack: () => seek(10),
      seekbackward: () => seek(-10),
      seekforward: () => seek(10),
      seekto: (details) => {
        if (details && Number.isFinite(Number(details.seekTime)) && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.max(0, Math.min(audio.duration, Number(details.seekTime)));
          updateAudioPlayerControls();
        }
      },
    };
    Object.keys(handlers).forEach(action => {
      try { navigator.mediaSession.setActionHandler(action, handlers[action]); } catch (e) { /* action unavailable */ }
    });
  }

  function clearMediaSessionActions() {
    if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') return;
    ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'].forEach(action => {
      try { navigator.mediaSession.setActionHandler(action, null); } catch (e) { /* action unavailable */ }
    });
  }

  function installDeviceSpeechMediaSessionHandlers() {
    if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') return;
    const handlers = {
      play: () => resumeDeviceSpeech(),
      pause: () => pauseDeviceSpeech(),
      previoustrack: () => moveDeviceSpeech(-1),
      nexttrack: () => moveDeviceSpeech(1),
      seekbackward: () => moveDeviceSpeech(-1),
      seekforward: () => moveDeviceSpeech(1),
      seekto: (details) => {
        if (details && Number.isFinite(Number(details.seekTime))) {
          moveDeviceSpeech(Math.round(Number(details.seekTime)) - deviceSpeechState.index);
        }
      },
    };
    Object.keys(handlers).forEach(action => {
      try { navigator.mediaSession.setActionHandler(action, handlers[action]); } catch (e) { /* action unavailable */ }
    });
  }

  function speakDeviceChunk(index, fromUserGesture) {
    const synth = window.speechSynthesis;
    if (!synth || !deviceSpeechState.active || !deviceSpeechState.chunks.length) return;
    if (index < 0 || index >= deviceSpeechState.chunks.length) {
      deviceSpeechState.playing = false;
      deviceSpeechState.pending = false;
      const status = $('#device-audio-status');
      if (status) status.textContent = 'Озвучивание завершено.';
      updateDeviceSpeechControls();
      return;
    }
    deviceSpeechState.index = index;
    const token = ++deviceSpeechState.token;
    if (deviceSpeechState.watchdog) clearTimeout(deviceSpeechState.watchdog);
    deviceSpeechState.watchdog = null;
    if (synth.speaking || synth.pending || synth.paused) {
      try { synth.cancel(); } catch (e) { /* speech engine may be unavailable */ }
    }
    const utterance = new window.SpeechSynthesisUtterance(deviceSpeechState.chunks[index]);
    utterance.lang = 'ru-RU';
    utterance.rate = deviceSpeechState.rate;
    utterance.volume = 1;
    const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
    const russianVoice = voices.find(v => /^ru([-_]|$)/i.test(v.lang || '') && v.localService) ||
      voices.find(v => /^ru([-_]|$)/i.test(v.lang || ''));
    if (russianVoice) utterance.voice = russianVoice;
    deviceSpeechState.utterance = utterance;
    deviceSpeechState.playing = false;
    deviceSpeechState.pending = true;
    const status = $('#device-audio-status');
    if (status) status.textContent = 'Запускаю системный голос…';
    utterance.onstart = () => {
      if (token !== deviceSpeechState.token || !deviceSpeechState.active) return;
      deviceSpeechState.pending = false;
      deviceSpeechState.playing = true;
      if (status) status.textContent = russianVoice
        ? 'Читает системный русский голос телефона…'
        : 'Читает голос системы телефона…';
      if (deviceSpeechState.watchdog) clearTimeout(deviceSpeechState.watchdog);
      deviceSpeechState.watchdog = null;
      updateDeviceSpeechControls();
    };
    utterance.onpause = () => {
      if (token !== deviceSpeechState.token || !deviceSpeechState.active) return;
      deviceSpeechState.pending = false;
      deviceSpeechState.playing = false;
      updateDeviceSpeechControls();
    };
    utterance.onresume = () => {
      if (token !== deviceSpeechState.token || !deviceSpeechState.active) return;
      deviceSpeechState.pending = false;
      deviceSpeechState.playing = true;
      updateDeviceSpeechControls();
    };
    utterance.onend = () => {
      if (token !== deviceSpeechState.token || !deviceSpeechState.active) return;
      deviceSpeechState.pending = false;
      if (deviceSpeechState.playing && deviceSpeechState.index + 1 < deviceSpeechState.chunks.length) {
        speakDeviceChunk(deviceSpeechState.index + 1, false);
      } else if (deviceSpeechState.index + 1 >= deviceSpeechState.chunks.length) {
        deviceSpeechState.playing = false;
        if (status) status.textContent = 'Озвучивание завершено.';
        updateDeviceSpeechControls();
      } else updateDeviceSpeechControls();
    };
    utterance.onerror = event => {
      if (token !== deviceSpeechState.token || !deviceSpeechState.active) return;
      deviceSpeechState.pending = false;
      deviceSpeechState.playing = false;
      if (status) status.textContent = event && event.error === 'not-allowed'
        ? 'Safari заблокировал звук. Нажмите центральную ▶, чтобы запустить его касанием.'
        : 'Системный голос не запустился. Нажмите ▶ ещё раз или проверьте голос и громкость iPhone.';
      if (deviceSpeechState.watchdog) clearTimeout(deviceSpeechState.watchdog);
      deviceSpeechState.watchdog = null;
      updateDeviceSpeechControls();
    };
    try {
      synth.speak(utterance);
      updateDeviceSpeechControls();
      deviceSpeechState.watchdog = setTimeout(() => {
        if (token !== deviceSpeechState.token || !deviceSpeechState.active ||
            !deviceSpeechState.pending || deviceSpeechState.playing) return;
        deviceSpeechState.pending = false;
        deviceSpeechState.playing = false;
        if (status) status.textContent =
          'Safari не начал озвучивание. Нажмите центральную ▶ ещё раз; проверьте громкость iPhone и голос «Русский» в настройках озвучивания.';
        updateDeviceSpeechControls();
      }, 2200);
    } catch (e) {
      deviceSpeechState.pending = false;
      deviceSpeechState.playing = false;
      if (status) status.textContent = 'Не удалось запустить системный голос: ' + String(e && e.message || e);
      updateDeviceSpeechControls();
    }
  }

  function moveDeviceSpeech(offset) {
    if (!deviceSpeechState.active || !deviceSpeechState.chunks.length) return;
    const next = deviceSpeechState.index + offset;
    if (next < 0) {
      if ($('#device-audio-status')) $('#device-audio-status').textContent = 'Это начало текста.';
      updateDeviceSpeechControls();
      return;
    }
    if (next >= deviceSpeechState.chunks.length) {
      deviceSpeechState.playing = false;
      if ($('#device-audio-status')) $('#device-audio-status').textContent = 'Достигнут конец текста.';
      try { window.speechSynthesis.cancel(); } catch (e) { /* no-op */ }
      updateDeviceSpeechControls();
      return;
    }
    speakDeviceChunk(next);
  }

  function pauseDeviceSpeech() {
    if (!deviceSpeechState.active) return;
    try { window.speechSynthesis.pause(); } catch (e) { /* speech API varies by browser */ }
    deviceSpeechState.playing = false;
    if ($('#device-audio-status')) $('#device-audio-status').textContent = '';
    updateDeviceSpeechControls();
  }

  function resumeDeviceSpeech() {
    if (!deviceSpeechState.active) return;
    const synth = window.speechSynthesis;
    if (deviceSpeechState.pending || (!deviceSpeechState.playing && synth && !synth.paused)) {
      if (deviceSpeechState.watchdog) clearTimeout(deviceSpeechState.watchdog);
      deviceSpeechState.watchdog = null;
      deviceSpeechState.pending = false;
      deviceSpeechState.priming = false;
      try { if (synth && (synth.speaking || synth.pending || synth.paused)) synth.cancel(); } catch (e) { /* no-op */ }
      speakDeviceChunk(deviceSpeechState.index, true);
      return;
    }
    if (synth && synth.paused) {
      try { synth.resume(); deviceSpeechState.playing = true; } catch (e) { /* continue below */ }
      updateDeviceSpeechControls();
      return;
    }
    if (synth && synth.speaking && deviceSpeechState.utterance) {
      deviceSpeechState.playing = true;
      updateDeviceSpeechControls();
      return;
    }
    speakDeviceChunk(deviceSpeechState.index, true);
  }

  function closeDeviceSpeechPlayer() {
    pendingDeviceSpeechMessageId = null;
    deviceSpeechState.active = false;
    deviceSpeechState.playing = false;
    deviceSpeechState.pending = false;
    deviceSpeechState.priming = false;
    deviceSpeechState.token += 1;
    if (deviceSpeechState.watchdog) clearTimeout(deviceSpeechState.watchdog);
    deviceSpeechState.watchdog = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* no-op */ }
    const shell = $('#device-audio-player-shell');
    if (shell) {
      shell.classList.remove('open');
      shell.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('audio-player-open');
    if ($('#audio-player-shell') && $('#audio-player-shell').classList.contains('open')) {
      installFileAudioMediaSessionHandlers();
    } else {
      clearMediaSessionActions();
      if (navigator.mediaSession) {
        try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch (e) { /* no-op */ }
      }
    }
  }

  function startDeviceSpeech(messageId) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      toast('Системная озвучка недоступна в этом браузере. Используйте генерацию ИИ-аудио.', 'error');
      return;
    }
    const id = String(messageId || '');
    const node = findNode(state.tree, id);
    if (!node || !String(node.content || '').trim()) return;
    const aiShell = $('#audio-player-shell');
    if (aiShell && aiShell.classList.contains('open')) closeAudioPlayer();
    if (deviceSpeechState.active) closeDeviceSpeechPlayer();

    state.audioMessageId = id;
    deviceSpeechState.messageId = id;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    const shell = $('#device-audio-player-shell');
    if (!shell) return;
    const title = $('#device-audio-title');
    if (title) title.textContent = (chat && chat.title ? chat.title : 'Ответ') + ' · системная озвучка';
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('audio-player-open');
    if (navigator.mediaSession && typeof window.MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: title ? title.textContent : 'Системная озвучка',
          artist: 'ai-ch',
          album: 'Воспроизведение устройством',
        });
      } catch (e) { /* optional */ }
    }
    installDeviceSpeechMediaSessionHandlers();

    const readable = state.readableText[id];
    const status = $('#device-audio-status');
    if (!readable || readable.status !== 'ready' || !String(readable.text || '').trim()) {
      pendingDeviceSpeechMessageId = id;
      if (status) status.textContent = 'Подготавливаю читабельный текст…';
      updateSpeechPlayerUi(id);
      updateDeviceSpeechControls();
      if (!readable || readable.status === 'missing' || readable.status === 'failed') {
        generateReadableText(id, true).then(record => {
          if (record && record.status === 'ready') startPendingDeviceSpeechIfReady(id);
          else if (record && record.status === 'failed' && status) {
            status.textContent = 'Не удалось подготовить текст для системной озвучки.';
          }
        }).catch(() => {
          if (status) status.textContent = 'Не удалось связаться с сервером подготовки текста.';
        });
      } else {
        startReadableTextStatusPolling();
      }
      requestAnimationFrame(() => $('#device-audio-close-btn')?.focus());
      return;
    }

    pendingDeviceSpeechMessageId = null;
    const text = String(readable.text);
    const words = text.match(/\S+/g) || [];
    if (!words.length) {
      if (status) status.textContent = 'В этом ответе нет текста для озвучивания.';
      return;
    }
    deviceSpeechState.messageId = id;
    deviceSpeechState.text = text;
    deviceSpeechState.words = words;
    deviceSpeechState.chunks = [];
    for (let i = 0; i < words.length; i += DEVICE_SPEECH_CHUNK_SIZE) {
      deviceSpeechState.chunks.push(words.slice(i, i + DEVICE_SPEECH_CHUNK_SIZE).join(' '));
    }
    deviceSpeechState.index = 0;
    deviceSpeechState.rate = Number($('#device-audio-rate') && $('#device-audio-rate').value) || 1;
    deviceSpeechState.active = true;
    deviceSpeechState.playing = false;
    deviceSpeechState.pending = false;
    deviceSpeechState.priming = false;
    if (status) status.textContent = 'Запускаю системный голос…';
    updateSpeechPlayerUi(id);
    speakDeviceChunk(0, true);
    requestAnimationFrame(() => $('#device-audio-close-btn')?.focus());
  }

  function bindDeviceSpeechPlayer() {
    $$('[data-device-audio-close]').forEach(btn => btn.addEventListener('click', closeDeviceSpeechPlayer));
    $('#device-audio-play-toggle')?.addEventListener('click', () => {
      if (deviceSpeechState.playing) pauseDeviceSpeech();
      else resumeDeviceSpeech();
    });
    $$('[data-device-audio-action]').forEach(btn => btn.addEventListener('click', () => {
      moveDeviceSpeech(btn.dataset.deviceAudioAction === 'back' ? -1 : 1);
    }));
    $('#device-audio-rate')?.addEventListener('change', (event) => {
      deviceSpeechState.rate = Number(event.target.value) || 1;
      if (deviceSpeechState.active && deviceSpeechState.playing) speakDeviceChunk(deviceSpeechState.index);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#device-audio-player-shell')?.classList.contains('open')) closeDeviceSpeechPlayer();
    });
  }

  function bindAudioPlayer() {
    const audio = $('#audio-player-source');
    if (!audio) return;
    audio.addEventListener('loadedmetadata', updateAudioPlayerControls);
    audio.addEventListener('timeupdate', updateAudioPlayerControls);
    audio.addEventListener('play', updateAudioPlayerControls);
    audio.addEventListener('pause', updateAudioPlayerControls);
    audio.addEventListener('ended', updateAudioPlayerControls);
    const rateSelect = $('#audio-player-rate');
    if (rateSelect) rateSelect.addEventListener('change', () => { audio.playbackRate = Number(rateSelect.value) || 1; });
    $('#audio-player-generate-btn')?.addEventListener('click', () => {
      if (state.audioMessageId) generateAnswerAudio(state.audioMessageId);
    });
    $$('[data-player-mode]').forEach(btn => btn.addEventListener('click', () => {
      const mode = btn.dataset.playerMode;
      const aiShell = $('#audio-player-shell');
      const deviceShell = $('#device-audio-player-shell');
      const id = String(state.audioMessageId || pendingDeviceSpeechMessageId || deviceSpeechState.messageId || '');
      if (!id) return;
      if (mode === 'device') {
        if (deviceShell && deviceShell.classList.contains('open')) return;
        startDeviceSpeech(id);
      } else {
        if (aiShell && aiShell.classList.contains('open')) return;
        if (deviceShell && deviceShell.classList.contains('open')) closeDeviceSpeechPlayer();
        openAudioPlayer(id, !!state.audioReady[id]);
      }
    }));
    $$('[data-audio-close]').forEach(btn => btn.addEventListener('click', closeAudioPlayer));
    $('#audio-play-toggle')?.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => toast('Не удалось запустить аудио.', 'error'));
      else audio.pause();
    });
    const seekAudio = (offset) => {
      const current = Number(audio.currentTime) || 0;
      const duration = Number.isFinite(audio.duration) ? audio.duration : current + 10;
      audio.currentTime = Math.max(0, Math.min(duration, current + offset));
      updateAudioPlayerControls();
    };
    $$('[data-audio-action]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.audioAction === 'back') seekAudio(-10);
      else if (btn.dataset.audioAction === 'forward') seekAudio(10);
    }));
    installFileAudioMediaSessionHandlers();
    $('#audio-progress')?.addEventListener('input', ev => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(ev.target.value) / 1000) * audio.duration;
      }
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && $('#audio-player-shell')?.classList.contains('open')) closeAudioPlayer();
    });
  }

  function openDeviceCodeRunner(item, messageId, options) {
    const background = !!(options && options.background);
    const shell = $('#device-code-shell');
    const frame = $('#device-code-frame');
    const status = $('#device-code-status');
    const fileBox = $('#device-code-files');
    const errorBox = $('#device-code-errors');
    if (!item || (!background && (!shell || !frame))) return;
    const normalizedMessageId = typeof messageId === 'string' && messageId ? messageId : null;
    if (background && !normalizedMessageId) return;
    let targetFrame = frame;
    if (background) {
      const previous = backgroundDeviceRunners.get(normalizedMessageId);
      if (previous && previous.frame) {
        try { previous.frame.srcdoc = ''; previous.frame.remove(); } catch (e) { /* frame already gone */ }
      }
      targetFrame = document.createElement('iframe');
      targetFrame.title = 'Фоновое выполнение кода AI-Ch';
      targetFrame.setAttribute('sandbox', 'allow-scripts');
      targetFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
      document.body.appendChild(targetFrame);
      backgroundDeviceRunners.set(normalizedMessageId, {
        frame: targetFrame, messageId: normalizedMessageId, startedAt: Date.now(),
      });
    } else {
      deviceCodeMessageId = normalizedMessageId;
      if (shell) shell.classList.remove('background-status-mode');
      const backgroundStatus = $('#device-code-background-status');
      if (backgroundStatus) { backgroundStatus.hidden = true; backgroundStatus.textContent = ''; }
      deviceCodeFileUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { /* no-op */ } });
      deviceCodeFileUrls.length = 0; deviceCodeLastError = ''; deviceCodeErrorUrl = null;
      if (fileBox) { fileBox.replaceChildren(); fileBox.hidden = true; }
      if (errorBox) { errorBox.replaceChildren(); errorBox.hidden = true; }
    }

    const rawLang = String(item.lang || '').trim().toLowerCase();
    const lang = rawLang === 'run' ? 'python' : rawLang;
    const code = String(item.code || '');
    const base64 = btoa(unescape(encodeURIComponent(code)));
    const runnerHook = "<script>(function(){function send(message){try{parent.postMessage({type:\"device-code-error\",message:String(message).slice(0,50000)},\"*\")}catch(_){}}window.addEventListener(\"error\",function(e){send((e.message||\"JavaScript error\")+(e.filename?\" (\"+e.filename+\":\"+e.lineno+\")\":\"\"))});window.addEventListener(\"unhandledrejection\",function(e){send(e.reason&&(e.reason.message||e.reason.stack)||e.reason||\"Unhandled promise rejection\")});})();</script>";
    const pageStart = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{font:14px/1.5 system-ui,sans-serif;padding:16px;margin:0;color:#272722;background:#faf9f5}' +
      'pre{white-space:pre-wrap;overflow-wrap:anywhere}#output{display:block;box-sizing:border-box;padding:12px;background:#f0eee6;border:1px solid #e4e0d5;border-radius:10px;min-height:120px;max-height:52vh;overflow:auto;overscroll-behavior:contain}' +
      '.note{color:#6f6f67}.demo-board{max-width:680px;margin:18px auto;padding:18px;border:1px solid #e4e2db;border-radius:16px}' +
      '.demo-header{display:flex;align-items:center;gap:12px;margin-bottom:18px}.demo-logo{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#e9e7df;font-weight:800}' +
      '.demo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.demo-card{padding:16px;border:1px solid #e5e3dd;border-radius:12px;background:#faf9f6}' +
      '.demo-button{border:0;border-radius:10px;padding:10px 15px;background:#34332e;color:#fff;font:inherit}' +
      '.demo-pill{display:inline-block;border:1px solid #dedbd2;border-radius:999px;padding:4px 9px;font-size:12px}' +
      '</style>' + runnerHook + '</head><body>';
    const output = '<pre id="output" aria-live="polite">Запуск…</pre>';
    let doc = '';
    let message = '';

    if (['html', 'htm'].includes(lang)) {
      doc = code;
      message = 'HTML/CSS/JavaScript отображаются в изолированной песочнице на этом устройстве.';
    } else if (lang === 'svg') {
      doc = pageStart + '<p class="note">SVG · локальный предпросмотр</p><main class="demo-board">' + code + '</main></body></html>';
      message = 'SVG открыт в изолированном предпросмотре.';
    } else if (['js', 'javascript', 'mjs'].includes(lang)) {
      const jsScript =
        '(function(){const out=document.getElementById("output");const write=v=>{out.textContent+=String(v)+"\\n";};' +
        'const source=new TextDecoder().decode(Uint8Array.from(atob("' + base64 + '"),c=>c.charCodeAt(0)));' +
        'const safeConsole={log:(...a)=>write(a.map(v=>typeof v==="object"?JSON.stringify(v):String(v)).join(" ")),info:(...a)=>write(a.map(String).join(" ")),warn:(...a)=>write("WARN: "+a.map(String).join(" ")),error:(...a)=>write("ERROR: "+a.map(String).join(" "))};' +
        'console.log=safeConsole.log;console.info=safeConsole.info;console.warn=safeConsole.warn;console.error=safeConsole.error;out.textContent="";' +
        'try{const result=(new Function("console","write","return (async function(){\\n"+source+"\\n}).call(window);"))(safeConsole,write);' +
        'Promise.resolve(result).then(()=>{write("Код завершён.");try{parent.postMessage({type:"device-code-status",message:"JavaScript выполнен. Результат готов."},"*")}catch(_){}}).catch(e=>{write(e&&e.stack?e.stack:String(e));try{parent.postMessage({type:"device-code-error",message:String(e&&(e.stack||e.message)||e)},"*")}catch(_){}});' +
        '}catch(e){write(e&&e.stack?e.stack:String(e));try{parent.postMessage({type:"device-code-error",message:String(e&&(e.stack||e.message)||e)},"*")}catch(_){};}})();';
      doc = pageStart + '<p class="note">JavaScript · локальная песочница с DOM внутри iframe</p>' +
        '<main id="app" class="demo-board"><div class="demo-header"><span class="demo-logo">JS</span><div><b>Предпросмотр</b><div class="note">Код может менять документ</div></div></div>' +
        '<div class="demo-grid"><article class="demo-card"><span class="demo-pill">Новая функция</span><h3>Карточка</h3><p>Демо-контент для стилизации DOM.</p><button class="demo-button">Основное действие</button></article></div></main>' +
        output + '<script>' + jsScript + '</script></body></html>';
      message = 'JavaScript выполняется локально; доступны DOM, CSS, canvas и асинхронный код.';
    } else if (lang === 'css') {
      doc = pageStart + '<p class="note">CSS · демонстрационный макет</p><main class="demo-board">' +
        '<header class="demo-header"><span class="demo-logo">Aa</span><div><b>Заголовок интерфейса</b><div class="note">Подзаголовок и описание</div></div></header>' +
        '<div class="demo-grid"><article class="demo-card"><span class="demo-pill">Новая функция</span><h3>Карточка</h3><p>Проверьте типографику, цвета, отступы, рамки и тени.</p><button class="demo-button">Основное действие</button></article>' +
        '<article class="demo-card"><h3>Данные</h3><p>Значение <strong>128,4</strong></p><div class="demo-pill">Готово</div></article></div></main>' +
        '<script>(function(){const s=decodeURIComponent(escape(atob("' + base64 + '")));const st=document.createElement("style");st.textContent=s;document.head.appendChild(st);})();<\/script></body></html>';
      message = 'CSS применяется к демонстрационному интерфейсу. Для полноценного дизайна запускайте HTML/CSS вместе.';
    } else if (['py', 'python', 'python3'].includes(lang)) {
      const pyScript = DEVICE_PYTHON_RUNNER_TEMPLATE
        .replace('__BASE64__', base64)
        .replace('__MESSAGE_ID__', JSON.stringify(normalizedMessageId || ''))
        .replace('__BACKGROUND__', background ? 'true' : 'false');
      doc = pageStart + '<p class="note">Python WebAssembly · модули загружаются по import; файлы документов и изображения можно скачать ниже.</p>' +
        output + '<script src="https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.js"><\/script>' +
        '<script>' + pyScript + '<\/script></body></html>';
      message = 'Python готовится. Runtime и подходящие модули загружаются на устройство по import; первый запуск требует интернет.';
    } else {
      toast('Песочница на устройстве поддерживает HTML, CSS, SVG, JavaScript и Python. Для остальных языков используйте песочницу на сайте.', 'error');
      return;
    }

    if (['html', 'htm'].includes(lang)) {
      if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, head => head + runnerHook);
      else if (/<body[^>]*>/i.test(doc)) doc = doc.replace(/<body[^>]*>/i, body => body + runnerHook);
      else doc += runnerHook;
    }
    if (background) {
      targetFrame.srcdoc = doc;
      return;
    }
    if (status) status.textContent = message;
    if (fileBox) fileBox.hidden = true;
    if (lang === 'html' || lang === 'htm') targetFrame.onload = () => { if (status && shell.classList.contains('open')) status.textContent = 'Интерактивный результат загружен и готов к работе на устройстве.'; };
    else targetFrame.onload = null;
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('device-code-open');
    targetFrame.srcdoc = doc;
    requestAnimationFrame(() => shell.querySelector('.device-code-panel')?.focus());
  }

  function closeDeviceCodeRunner() {
    const shell = $('#device-code-shell');
    const frame = $('#device-code-frame');
    const fileBox = $('#device-code-files');
    if (shell) {
      shell.classList.remove('open');
      shell.setAttribute('aria-hidden', 'true');
    }
    if (frame) frame.srcdoc = '';
    deviceCodeMessageId = null;
    if (shell) shell.classList.remove('background-status-mode');
    const backgroundStatus = $('#device-code-background-status');
    if (backgroundStatus) { backgroundStatus.hidden = true; backgroundStatus.textContent = ''; }
    if (fileBox) { fileBox.replaceChildren(); fileBox.hidden = true; }
    const errorBox = $('#device-code-errors'); if (errorBox) { errorBox.replaceChildren(); errorBox.hidden = true; }
    deviceCodeLastError = ''; deviceCodeErrorUrl = null;
    deviceCodeFileUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { /* no-op */ } });
    deviceCodeFileUrls.length = 0;
    document.body.classList.remove('device-code-open');
  }

  function bindDeviceCodeRunner() {
    $$('[data-device-code-close]').forEach(button => button.addEventListener('click', closeDeviceCodeRunner));
    window.addEventListener('message', async event => {
      const frame = $('#device-code-frame');
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data;
      let backgroundEntry = null;
      for (const runner of backgroundDeviceRunners.values()) {
        if (runner && runner.frame && event.source === runner.frame.contentWindow) {
          backgroundEntry = runner;
          break;
        }
      }
      const visibleSource = !!(frame && event.source === frame.contentWindow);
      if (!visibleSource && !backgroundEntry) return;
      const isBackground = !!backgroundEntry || data.background === true;
      const messageId = String(data.messageId || (backgroundEntry && backgroundEntry.messageId) || deviceCodeMessageId || '');
      const status = $('#device-code-status');
      const messageNode = messageId ? findNode(state.tree, messageId) : null;
      if (data.type === 'device-code-log') {
        if (isBackground && messageNode) {
          const line = String(data.message || '').slice(0, 5000);
          messageNode.deviceRunnerLogs = (String(messageNode.deviceRunnerLogs || '') + line + '\n').slice(-30000);
          updateDeviceRunnerStatusPanel(messageId, messageNode);
        }
        return;
      }
      if (data.type === 'device-code-status') {
        if (isBackground) {
          if (messageNode) {
            messageNode.deviceRunnerStatus = String(data.message || '').slice(0, 500);
            updateDeviceRunnerStatusPanel(messageId, messageNode, data.message);
            if (state.currentChatId && findNode(state.tree, messageId)) renderMessageInPlace(messageId);
          } else {
            updateDeviceRunnerStatusPanel(messageId, null, data.message);
          }
        } else if (status && typeof data.message === 'string') status.textContent = data.message.slice(0, 500);
        return;
      }
      if (data.type === 'device-code-complete') {
        const pendingPersistence = deviceFilePersistence.get(messageId);
        if (pendingPersistence) await pendingPersistence;
        if (messageNode) {
          messageNode.deviceRunnerFinishedAt = Date.now();
          const skippedFiles = Array.isArray(data.skipped) ? data.skipped.filter(Boolean).map(x => String(x).slice(0, 160)) : [];
          messageNode.deviceRunnerStatus = deviceFilePersistenceErrors.has(messageId)
            ? 'Созданный файл не удалось сохранить на сервере'
            : (skippedFiles.length
              ? 'Частичный результат · пропущено файлов: ' + skippedFiles.length
              : (data.success ? 'completed' : 'failed'));
          messageNode.deviceRunnerFiles = Math.max(0, Number(data.files) || 0);
          if (deviceFilePersistenceErrors.has(messageId)) {
            messageNode.deviceRunnerError = 'Сохранение файлов: ' + deviceFilePersistenceErrors.get(messageId);
          } else if (skippedFiles.length) {
            messageNode.deviceRunnerError = 'Не переданы на устройство: ' + skippedFiles.join('; ');
          } else {
            messageNode.deviceRunnerError = null;
          }
        }
        if (isBackground && backgroundEntry) {
          try { backgroundEntry.frame.srcdoc = ''; backgroundEntry.frame.remove(); } catch (e) { /* frame already gone */ }
          backgroundDeviceRunners.delete(messageId);
        } else if (status) {
          const skippedFiles = Array.isArray(data.skipped) ? data.skipped.filter(Boolean).map(x => String(x).slice(0, 160)) : [];
          status.textContent = skippedFiles.length
            ? 'Создание завершено частично. Пропущено: ' + skippedFiles.join('; ')
            : (data.success ? 'Выполнение на устройстве завершено.' :
              (deviceCodeLastError ? 'Ошибка выполнения. Логи можно скачать или скопировать ниже.' :
                'Локальный запуск завершился без результата.'));
        }
        if (messageNode) {
          updateDeviceRunnerStatusPanel(messageId, messageNode);
          if (state.currentChatId && findNode(state.tree, messageId)) renderMessageInPlace(messageId);
        }
        return;
      }
      if (data.type === 'device-code-error') {
        const message = String(data.message || 'Неизвестная ошибка выполнения').slice(0, 50000);
        if (isBackground) {
          if (messageNode) {
            messageNode.deviceRunnerError = message;
            messageNode.deviceRunnerStatus = 'Ошибка при создании файла на устройстве.';
            updateDeviceRunnerStatusPanel(messageId, messageNode);
            if (state.currentChatId && findNode(state.tree, messageId)) renderMessageInPlace(messageId);
          } else {
            updateDeviceRunnerStatusPanel(messageId, null, message);
          }
          return;
        }
        const errorBox = $('#device-code-errors');
        if (!errorBox) return;
        deviceCodeLastError = [deviceCodeLastError, message].filter(Boolean).join('\n\n---\n\n').slice(-100000);
        errorBox.hidden = false;
        let log = $('.device-code-error-log', errorBox);
        if (!log) {
          errorBox.replaceChildren();
          log = document.createElement('pre'); log.className = 'device-code-error-log'; errorBox.appendChild(log);
          const actions = document.createElement('div'); actions.className = 'device-code-error-actions';
          const download = document.createElement('a'); download.className = 'device-code-error-download'; download.textContent = 'Скачать логи ошибки'; download.download = 'ai-ch-error-logs.txt'; actions.appendChild(download);
          const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Скопировать логи ошибки'; copy.addEventListener('click', async () => {
            const ok = await copyText(deviceCodeLastError); toast(ok ? 'Логи ошибки скопированы' : 'Не удалось скопировать логи', ok ? '' : 'error');
          });
          actions.appendChild(copy); errorBox.appendChild(actions);
        }
        log.textContent = deviceCodeLastError;
        if (deviceCodeErrorUrl) { try { URL.revokeObjectURL(deviceCodeErrorUrl); } catch (e) {} }
        deviceCodeErrorUrl = URL.createObjectURL(new Blob([deviceCodeLastError], {type:'text/plain;charset=utf-8'}));
        deviceCodeFileUrls.push(deviceCodeErrorUrl);
        const download = $('.device-code-error-download', errorBox);
        if (download) download.href = deviceCodeErrorUrl;
        if (status) status.textContent = 'Ошибка выполнения. Логи можно скачать или скопировать ниже.';
        return;
      }
      if (data.type !== 'device-code-file' || typeof data.name !== 'string' || !data.bytes) return;
      const fileBox = $('#device-code-files');
      try {
        const bytes = new Uint8Array(data.bytes);
        if (!bytes.length) return;
        if (bytes.length > 25 * 1024 * 1024) {
          const warning = 'Файл «' + normaliseOutputFilename(data.name, data.mime) + '» превышает лимит передачи 25 МБ на устройство.';
          if (messageNode) {
            messageNode.deviceRunnerStatus = warning;
            messageNode.deviceRunnerError = warning;
          }
          if (!isBackground) {
            if (status) status.textContent = warning;
            else toast(warning, 'error');
          }
          return;
        }
        let normalizedName = normaliseOutputFilename(data.name, data.mime);
        const normalizedExt = normalizedName.slice(normalizedName.lastIndexOf('.')).toLowerCase();
        const officeMime = {
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }[normalizedExt];
        const blob = new Blob([bytes], { type: officeMime || String(data.mime || 'application/octet-stream') });
        if (isBackground) {
          if (messageId) {
            rememberDeviceFileForMessage(messageId, normalizedName, blob);
            await persistDeviceFileForMessage(messageId, normalizedName, blob);
          }
          if (messageNode) {
            messageNode.deviceRunnerFiles = (Number(messageNode.deviceRunnerFiles) || 0) + 1;
            messageNode.deviceRunnerStatus = deviceFilePersistenceErrors.has(messageId)
              ? 'file-created-local-only' : 'file-created-server';
            updateDeviceRunnerStatusPanel(messageId, messageNode);
            if (state.currentChatId && findNode(state.tree, messageId)) renderMessageInPlace(messageId);
          }
          return;
        }
        if (!fileBox) return;
        const url = URL.createObjectURL(blob);
        deviceCodeFileUrls.push(url);
        fileBox.hidden = false;
        const card = document.createElement('div');
        card.className = 'device-code-file-card';
        const link = document.createElement('a');
        link.href = url;
        link.download = normalizedName.replace(/[\\/\\0-\\x1f]/g, '_').slice(0, 180) || 'output.bin';
        link.className = 'device-code-file-download';
        link.textContent = 'Скачать · ' + link.download;
        card.appendChild(link);
        const size = document.createElement('small');
        size.className = 'device-code-file-size'; size.textContent = formatSize(blob.size); card.appendChild(size);
        if (/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(blob.type)) {
          const preview = document.createElement('img');
          preview.className = 'device-code-file-preview';
          preview.src = url;
          preview.alt = link.download;
          preview.loading = 'lazy';
          card.appendChild(preview);
        }
        fileBox.appendChild(card);
        if (messageId) {
          rememberDeviceFileForMessage(messageId, link.download, blob);
          const saved = await persistDeviceFileForMessage(messageId, link.download, blob);
          if (status) status.textContent = saved
            ? 'Файл сохранён в чате и доступен на других устройствах: ' + link.download
            : 'Файл остался на этом устройстве. Ошибка сервера: ' +
              (deviceFilePersistenceErrors.get(messageId) || 'неизвестная ошибка');
        } else if (status) status.textContent = 'Файл готов: ' + link.download + '. Нажмите ссылку для скачивания.';
      } catch (e) {
        if (status) status.textContent = 'Не удалось подготовить файл для скачивания: ' + String(e && e.message || e);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#device-code-shell')?.classList.contains('open')) closeDeviceCodeRunner();
    });
  }


  function deepResearchStatusLabel(status) {
    return ({
      queued: 'В очереди',
      working: 'Работает',
      searching: 'Ищет данные',
      done: 'Готово',
      failed: 'Не удалось',
      cancelled: 'Остановлено',
    })[String(status || '')] || 'Работает';
  }

  function deepResearchHtml(n) {
    const runs = Array.isArray(n && n.tool_runs) ? n.tool_runs : [];
    const flow = runs.find(run => run && run.kind === 'deep_research_flow');
    const agents = runs.filter(run => run && run.kind === 'deep_research_agent');
    if (!agents.length) return '';
    const byId = new Map(agents.map(agent => [String(agent.agent_id || ''), agent]));
    const edges = Array.isArray(flow && flow.edges) ? flow.edges : [];
    const connections = edges.map(edge => {
      const from = byId.get(String(edge.from || ''));
      const to = byId.get(String(edge.to || ''));
      if (!from || !to) return '';
      return '<div class="deep-research-connection"><span>' + escapeHtml(from.name || 'Агент') +
        '</span><span class="deep-research-arrow">→</span><span>' + escapeHtml(to.name || 'Агент') +
        '</span>' + (edge.label ? '<small>' + escapeHtml(edge.label) + '</small>' : '') + '</div>';
    }).filter(Boolean).join('');
    const active = agents.some(agent => ['queued', 'working', 'searching'].includes(String(agent.status || '')));
    return '<section class="deep-research-flow" aria-label="Deep Research: ход исследования">' +
      '<div class="deep-research-flow-head"><span class="deep-research-flow-mark">🧭</span>' +
      '<strong>Deep Research</strong><span class="deep-research-flow-state">' +
      (active ? thinkAnim() + ' Исследуют' : 'Исследование завершено') + '</span></div>' +
      '<div class="deep-research-agents">' + agents.map(agent => {
        const state = String(agent.status || 'queued');
        const marker = ['queued', 'working', 'searching'].includes(state)
          ? '<span class="deep-agent-spinner" aria-hidden="true"></span>'
          : state === 'done' ? '<span class="deep-agent-state-dot is-done">✓</span>'
          : '<span class="deep-agent-state-dot is-error">!</span>';
        const id = escapeHtml(String(agent.agent_id || ''));
        return '<button type="button" class="deep-research-agent-card" data-deep-agent-id="' + id +
          '" data-message-id="' + escapeHtml(String(n.id || '')) + '" aria-label="Открыть результат агента ' +
          escapeHtml(agent.name || 'Агент') + '">' +
          '<span class="deep-agent-card-top">' + marker + '<strong>' + escapeHtml(agent.name || 'Агент') +
          '</strong><small>' + escapeHtml(deepResearchStatusLabel(state)) + '</small></span>' +
          '<span class="deep-agent-card-task">' + escapeHtml(agent.task || '') + '</span>' +
          (agent.result ? '<span class="deep-agent-card-preview">' + escapeHtml(String(agent.result).slice(0, 180)) + '</span>' : '') +
          '</button>';
      }).join('') + '</div>' +
      (connections ? '<div class="deep-research-connections"><span class="deep-research-connections-title">Связи и передача результатов</span>' + connections + '</div>' : '') +
      '</section>';
  }

  function openDeepResearchAgentDetail(agent) {
    if (!agent) return;
    openAddToChatSheet();
    setAddChatView('agent-detail');
    const root = $('#add-chat-agent-detail-content');
    if (!root) return;
    const sources = (Array.isArray(agent.sources) ? agent.sources : []).filter(source =>
      source && /^https?:\/\//i.test(String(source.url || ''))
    );
    const sourceHtml = sources.length
      ? '<div class="deep-agent-detail-sources">' + sources.map((source, index) =>
        '<a class="add-chat-action deep-agent-source" href="' + escapeHtml(source.url) +
        '" target="_blank" rel="noopener noreferrer"><span class="add-chat-row-icon">' + icon('globe') +
        '</span><span class="add-chat-action-copy"><strong>' + escapeHtml(source.title || ('Источник ' + (index + 1))) +
        '</strong><small>' + escapeHtml(source.url) + '</small></span></a>'
      ).join('') + '</div>'
      : '<p class="usage-note">Агент не сохранил отдельные ссылки на источники.</p>';
    root.innerHTML = '<div class="deep-agent-detail">' +
      '<div class="deep-agent-detail-status">' + escapeHtml(deepResearchStatusLabel(agent.status)) + '</div>' +
      '<h3>' + escapeHtml(agent.name || 'Агент') + '</h3>' +
      '<section><strong>Назначение</strong><p>' + escapeHtml(agent.task || 'Задача не указана') + '</p></section>' +
      '<section><strong>Результат</strong><div class="deep-agent-detail-result">' +
      escapeHtml(agent.result || (agent.status === 'failed' ? 'Агент завершился с ошибкой.' : 'Результат появится по завершении работы.')) +
      '</div></section><section><strong>Источники</strong>' + sourceHtml + '</section></div>';
  }

  function toolRunsHtml(runs) {
    const items = Array.isArray(runs) ? runs.filter(r => r && typeof r === 'object' && !String(r.kind || '').startsWith('deep_research_')) : [];
    if (!items.length) return '';

    // Present internal executions as one result panel. Do not expose an operation count.
    const running = items.some(r => r.running);
    const last = items[items.length - 1];
    const failed = !running && (last.ok === false || !!last.timed_out);
    const timedOut = !running && !!last.timed_out;
    const uniqueFiles = new Map();
    items.forEach(run => (Array.isArray(run.files) ? run.files : []).forEach(file => {
      if (!file || typeof file !== 'object' || !file.file_id) return;
      const key = String(file.file_id);
      if (!uniqueFiles.has(key)) uniqueFiles.set(key, file);
    }));
    const files = [...uniqueFiles.values()].map(file => {
      const url = '/api/files/' + encodeURIComponent(String(file.file_id)) + '/download';
      if (file.kind === 'image') {
        return '<a class="tool-file img" href="' + url + '" target="_blank" rel="noopener">' +
          '<img src="' + url + '?inline=1" alt="' + escapeHtml(file.name || 'Изображение') + '" loading="lazy" /></a>';
      }
      return '<a class="tool-file" href="' + url + '" target="_blank" rel="noopener">' +
        icon('download') + '<span>' + escapeHtml(file.name || 'Созданный файл') + '</span>' +
        '<em>' + formatSize(file.size) + '</em></a>';
    }).join('');
    const failedFileplanWithFallback = items.some(run =>
      run.kind === 'fileplan' && !run.running && (run.ok === false || !!run.timed_out) &&
      isDeviceFallbackRun(run) && !(Array.isArray(run.files) && run.files.length)
    );
    if (failedFileplanWithFallback) return '';
    const code = items.map(run => String(run.code || '').trim()).filter(Boolean).join('\n\n# Подготовка результата\n');
    const stdout = items.map(run => String(run.stdout || '').trim()).filter(Boolean).join('\n\n');
    const stderr = items.map(run => String(run.stderr || '').trim()).filter(Boolean).join('\n\n');

    return '<div class="tool-box collapsed' + (failed ? ' err' : '') + '">' +
      '<div class="tool-head">' +
      (running ? thinkAnim() : icon('terminal')) +
      '<span class="tool-title">' +
      (running ? 'Подготавливаю результат…' : (failed ? 'Проверка результата требует внимания' : 'Результат подготовлен')) +
      '</span>' +
      (timedOut ? '<em class="warn">таймаут</em>' : '') +
      '<button type="button" class="tool-toggle" data-tool-toggle aria-expanded="false" title="Показать подробности">' +
      icon('chevron-down') + '<span data-tool-toggle-label>Подробности</span></button></div>' +
      '<div class="tool-content">' +
      (code ? '<pre class="tool-code">' + escapeHtml(code) + '</pre>' : '') +
      (stdout ? '<pre class="tool-out">' + escapeHtml(stdout) + '</pre>' : '') +
      (stderr ? '<pre class="tool-err">' + escapeHtml(stderr) + '</pre>' : '') +
      (files ? '<div class="tool-files">' + files + '</div>' : '') +
      '</div></div>';
  }

  function openSources(list) {
    openModal({
      title: 'Источники',
      okText: 'Закрыть',
      body: '<div class="src-list">' + list.map((s, i) =>
        '<a class="src-row" href="' + escapeHtml(s.url || '#') + '" target="_blank" rel="noopener">' +
        '<b>[' + (i + 1) + '] ' + escapeHtml(s.title || s.url || '') + '</b>' +
        (s.snippet ? '<span>' + escapeHtml(String(s.snippet).slice(0, 200)) + '</span>' : '') +
        '<em>' + escapeHtml(s.url || '') + '</em></a>').join('') + '</div>',
      onOk: () => true,
    });
  }

  function renderEmptyState() {
    const box = $('#messages');
    box.classList.add('empty');
    box.innerHTML = chatOriginBannerHtml() +
      '<div class="empty-state">' +
        '<h2 class="greet" id="greet-text">' +
          escapeHtml(GREETINGS[state.greetIdx % GREETINGS.length]) + '</h2>' +
      '</div>';
    rollPlaceholder();
    startRotation();
  }

  function rotateGreeting() {
    state.greetIdx = (state.greetIdx + 1) % GREETINGS.length;
    const el = $('#greet-text');
    if (!el) return;
    el.textContent = GREETINGS[state.greetIdx];
    el.classList.remove('greet');
    void el.offsetWidth;   // restart the CSS animation
    el.classList.add('greet');
  }

  function startRotation() {
    stopRotation();
    let tick = 0;
    state.greetTimer = setInterval(() => {
      if (!$('#greet-text')) { stopRotation(); return; }
      tick += 1;
      if (tick % 2 === 0) rotateGreeting();
    }, 11000);
  }

  function stopRotation() {
    if (state.greetTimer) { clearInterval(state.greetTimer); state.greetTimer = null; }
    if (state.tileTimer) { clearInterval(state.tileTimer); state.tileTimer = null; }
  }

  function updateShareButtonVisibility() {
    const button = $('#share-btn');
    if (button) button.classList.toggle('hidden', !state.currentChatId || !!state.readonly);
  }

  function renderMessages(options) {
    const box = $('#messages');
    if (!box) return;
    const opts = options || {};
    const wasAtBottom = state.stickBottom !== false;
    const previousScrollTop = box.scrollTop;
    updateShareButtonVisibility();
    const entries = allMessages(state.tree);
    if (!entries.length) {
      // Keep the existing empty-state DOM and animation instead of rebuilding it on every no-op render.
      if (!box.classList.contains('empty') || !box.querySelector('.empty-state')) renderEmptyState();
      updateScrollDownButton();
      return;
    }
    box.classList.remove('empty');
    stopRotation();
    box.innerHTML = chatOriginBannerHtml() + '<div class="msg-wrap">' +
      entries.map((e, i) => msgHtml(e, i === entries.length - 1)).join('') + '</div>';
    bindMessageEvents();
    renderMath(box.querySelector('.msg-wrap'));
    renderThemedEmojis(box.querySelector('.msg-wrap'));
    bindActionCarouselAutoplay(box);
    hydrateAudioStatuses(entries);
    hydrateReadableTextStatuses(entries);

    if (opts.focusMessageId) {
      const target = $$('.msg', box).find(el => el.dataset.mid === String(opts.focusMessageId));
      const content = target ? $('.content.md', target) : null;
      if (content) content.classList.add('answer-arrive');
      requestAnimationFrame(() => {
        scrollToMessageStart(opts.focusMessageId);
        requestAnimationFrame(updateScrollDownButton);
      });
    } else if (wasAtBottom) {
      scrollToBottom();
    } else {
      // A final/status refresh must not pull a reader back to the latest answer.
      box.scrollTop = previousScrollTop;
      state.stickBottom = false;
    }
    updateScrollDownButton();
  }

  function renderMessageInPlace(messageId, previousMessageId, options) {
    const box = $('#messages');
    const opts = options || {};
    const entries = allMessages(state.tree);
    const entryIndex = entries.findIndex(entry => String(entry.node.id) === String(messageId));
    const previousId = previousMessageId == null ? String(messageId) : String(previousMessageId);
    const oldMessage = $$('.msg', box).find(element => element.dataset.mid === previousId);
    if (entryIndex < 0 || !oldMessage) {
      renderMessages();
      return false;
    }

    const holder = document.createElement('div');
    holder.innerHTML = msgHtml(entries[entryIndex], entryIndex === entries.length - 1);
    const nextMessage = holder.firstElementChild;
    if (!nextMessage) {
      renderMessages();
      return false;
    }

    // This is an in-place update, not a newly arriving message; do not replay
    // the entrance animation for every intermediate tool/status event.
    nextMessage.classList.add('no-msg-entrance');
    oldMessage.replaceWith(nextMessage);
    bindMessageEvents(nextMessage);
    renderMath(nextMessage);
    renderThemedEmojis(nextMessage);
    bindActionCarouselAutoplay(nextMessage);
    if (String(state.activeAssistantId || '') === String(messageId)) bindStreamRefs();
    if (opts.focusMessageId) {
      const content = $('.content.md', nextMessage);
      if (content) content.classList.add('answer-arrive');
      requestAnimationFrame(() => scrollToMessageStart(opts.focusMessageId));
    } else if (state.stickBottom !== false) {
      scrollToBottom();
    }
    updateScrollDownButton();
    return true;
  }


  function bindMessageEvents(root) {
    const scope = root || $('#messages');
    $$('[data-deep-agent-id]', scope).forEach(button => button.addEventListener('click', () => {
      const messageId = String(button.dataset.messageId || '');
      const agentId = String(button.dataset.deepAgentId || '');
      const message = findNode(state.tree, messageId);
      const agent = (Array.isArray(message && message.tool_runs) ? message.tool_runs : [])
        .find(run => run && run.kind === 'deep_research_agent' && String(run.agent_id || '') === agentId);
      openDeepResearchAgentDetail(agent);
    }));
    $$('[data-tool-toggle]', scope).forEach(btn => btn.addEventListener('click', () => {
      const box = btn.closest('.tool-box');
      if (!box) return;
      const expanded = box.classList.toggle('collapsed') === false;
      btn.setAttribute('aria-expanded', String(expanded));
      btn.title = expanded ? 'Свернуть вывод' : 'Развернуть вывод';
      const label = $('[data-tool-toggle-label]', btn);
      if (label) label.textContent = expanded ? 'Свернуть' : 'Развернуть';
    }));
    $$( '.ask-card', scope).forEach(card => {
      const questions = $$('.ask-question', card);
      const send = () => {
        const answers = questions.map(question => {
          const label = $('.ask-question-label', question), input = $('.ask-input', question);
          return { question: label ? label.textContent.trim() : '', value: input ? String(input.value || '').trim() : '' };
        });
        if (!answers.length) return;
        if (answers.some(answer => !answer.value)) { toast(answers.length > 1 ? 'Ответьте на каждый вопрос или выберите вариант.' : 'Выберите вариант или введите ответ.', 'error'); return; }
        $('#input').value = answers.map(answer => answer.question + ': ' + answer.value).join('\n');
        const messageEl = card.closest('.msg');
        const messageNode = messageEl ? findNode(state.tree, messageEl.dataset.mid) : null;
        if (messageNode) { messageNode.askAnswers = answers; messageNode.askAnswered = true; messageNode.askCollapsed = true; }
        autoGrow();
        if (messageNode && state.currentChatId) renderMessageInPlace(messageNode.id);
        sendCurrent();
      };
      $$( '.ask-option', card).forEach(option => option.addEventListener('click', () => {
        const question = option.closest('.ask-question');
        if (!question) return;
        $$( '.ask-option', question).forEach(other => {
          const selected = other === option; other.classList.toggle('is-selected', selected); other.setAttribute('aria-pressed', String(selected));
        });
        const input = $('.ask-input', question);
        if (input) { input.value = option.dataset.askOption || ''; input.focus(); }
      }));
      $$( '.ask-input', card).forEach(input => {
        input.addEventListener('input', () => {
          if (!input.value.trim()) return;
          const question = input.closest('.ask-question');
          if (question) $$( '.ask-option', question).forEach(option => { option.classList.remove('is-selected'); option.setAttribute('aria-pressed', 'false'); });
        });
        input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
      });
      const btn = $('.ask-send', card);
      if (btn) btn.addEventListener('click', send);
    });

    $$('.ask-expand', scope).forEach(button => button.addEventListener('click', () => {
      const el=button.closest('.msg'), message=el?findNode(state.tree,el.dataset.mid):null;
      if (!message) return; message.askCollapsed=false; renderMessageInPlace(message.id);
    }));
    $$('.quiz-card [data-quiz-toggle]', scope).forEach(button => button.addEventListener('click', () => {
      const el=button.closest('.msg'), message=el?findNode(state.tree,el.dataset.mid):null;
      if (!message) return; message.quizCollapsed=button.dataset.quizToggle==='collapse'; renderMessageInPlace(message.id);
    }));
    $$('.quiz-option[data-quiz-option]', scope).forEach(button => button.addEventListener('click', () => {
      const el=button.closest('.msg'), message=el?findNode(state.tree,el.dataset.mid):null, question=button.closest('.quiz-question');
      if (!message||!question||message.quizSubmitted) return;
      const index=Number(button.dataset.quizIndex); if(!Number.isInteger(index)||index<0)return;
      const value=String(button.dataset.quizOption||''), multi=button.dataset.quizMultiple==='true';
      const current=Array.isArray(message.quizAnswers[index])?message.quizAnswers[index].slice():[];
      // Selecting any option clears a custom answer too, otherwise grading would ignore this selection.
      message.quizCustom=Array.isArray(message.quizCustom)?message.quizCustom:[];
      message.quizCustom[index]='';
      const custom=$('.quiz-custom-answer[data-quiz-custom="'+index+'"]',question);if(custom)custom.value='';
      let next;
      if(multi)next=current.includes(value)?current.filter(item=>item!==value):current.concat(value);
      else next=[value];
      message.quizAnswers=Array.isArray(message.quizAnswers)?message.quizAnswers:[];
      message.quizAnswers[index]=next;
      $$('[data-quiz-option]',question).forEach(option=>{
        const picked=next.includes(String(option.dataset.quizOption||''));
        option.classList.toggle('is-selected',picked);option.setAttribute('aria-pressed',String(picked));
      });
    }));
    $$('.quiz-custom-answer', scope).forEach(input => input.addEventListener('input', () => {
      const el=input.closest('.msg'),message=el?findNode(state.tree,el.dataset.mid):null,index=Number(input.dataset.quizCustom);
      if(!message||!Number.isInteger(index)||index<0||message.quizSubmitted)return;
      message.quizCustom=Array.isArray(message.quizCustom)?message.quizCustom:[];
      message.quizCustom[index]=input.value;
      if(input.value.trim()){
        message.quizAnswers=Array.isArray(message.quizAnswers)?message.quizAnswers:[];
        message.quizAnswers[index]=[];
        const question=input.closest('.quiz-question');
        if(question)$$('[data-quiz-option]',question).forEach(option=>{option.classList.remove('is-selected');option.setAttribute('aria-pressed','false');});
      }
    }));
    $$('.quiz-submit', scope).forEach(button => button.addEventListener('click', () => {
      const el=button.closest('.msg'),message=el?findNode(state.tree,el.dataset.mid):null;
      if(!message||!Array.isArray(message.quiz)||message.quizSubmitted)return;
      const items=message.quiz.slice(0,20),answers=Array.isArray(message.quizAnswers)?message.quizAnswers:[],custom=Array.isArray(message.quizCustom)?message.quizCustom:[];
      const norm=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[.,;:!?()[\]{}'"]/g,'').replace(/\s+/g,' ');
      const responses=[];
      const results=items.map((item,index)=>{
        const q=item&&typeof item==='object'?item:{question:String(item||'')};
        const free=String(custom[index]||'').trim(),picked=Array.isArray(answers[index])?answers[index].filter(Boolean):[];
        const values=free?[free]:picked,expected=Array.isArray(q.correct)?q.correct:(q.correct?[q.correct]:[]);
        const exp=expected.map(norm).filter(Boolean),actual=values.map(norm).filter(Boolean);
        const correct=exp.length>0&&(q.multiple?actual.length===exp.length&&exp.every(value=>actual.includes(value)):actual.length===1&&exp.includes(actual[0]));
        responses.push({question:String(q.question||''),values,expected});return{correct,values,expected};
      });
      const score=results.filter(item=>item.correct).length;
      message.quizResults=results;message.quizScore={correct:score,total:items.length};message.quizSubmitted=true;message.quizCollapsed=false;message.quizResponses=responses;message.quizResultSent=false;
      renderMessageInPlace(message.id);toast('Результат: '+score+' из '+items.length);
      // The model opts in during quiz generation only when its follow-up needs the score.
      if(items.some(item=>item&&typeof item==='object'&&item.send_result_to_ai===true)){
        sendQuizResultToAI(message);
      }
    }));
    $$('.quiz-send-result', scope).forEach(button => button.addEventListener('click', () => {
      const el=button.closest('.msg'),message=el?findNode(state.tree,el.dataset.mid):null;
      if(!message||!Array.isArray(message.quiz)||!message.quizSubmitted||message.quizResultSent)return;
      sendQuizResultToAI(message);
    }));
    $$('.mem-line', scope).forEach(el => el.addEventListener('click', () => openMemory(el.dataset.memline)));

    $$('.think-head', scope).forEach(h => h.addEventListener('click', () => {
      const box = h.closest('.think-box');
      if (!box) return;
      box.classList.toggle('collapsed');
      const msgEl = h.closest('.msg');
      const n = msgEl ? findNode(state.tree, msgEl.dataset.mid) : null;
      if (n) n.thinkCollapsed = box.classList.contains('collapsed');
    }));

    // Delegate message actions because individual controls may be replaced dynamically.
    const messageActions = $('#messages');
    if (messageActions && !messageActions.dataset.actionsBound) {
      messageActions.dataset.actionsBound = 'true';
      messageActions.addEventListener('click', async (event) => {
        const uiButton = event.target.closest('[data-ui-action]');
        if (uiButton && messageActions.contains(uiButton)) {
          const action = uiButton.dataset.uiAction;
          const value = uiButton.dataset.uiValue || '';
          if (action === 'copy') {
            const ok = await copyText(value);
            toast(ok ? 'Скопировано' : 'Не удалось скопировать', ok ? '' : 'error');
          } else if (action === 'fill') {
            const input = $('#input');
            if (input) { input.value = value; autoGrow(); input.focus(); toast('Текст перенесён в поле ввода'); }
          } else if (action === 'open') {
            const url = safeHttpUrl(value);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          } else if (action === 'open-origin-chat') {
            const sourceId = String(value || '');
            if (sourceId) await openChat(sourceId);
          }
          return;
        }
        const btn = event.target.closest('[data-mact]');
        if (!btn || !messageActions.contains(btn) || btn.disabled) return;
        const id = btn.dataset.id, act = btn.dataset.mact;
      if (act === 'copy') {
        const n = findNode(state.tree, id);
        if (n) await copyWithFeedback(btn, copyableAnswerText(n.content || ''));
      } else if (act === 'copy-user') {
        const n = findNode(state.tree, id);
        if (n) await copyWithFeedback(btn, copyableAnswerText(n.content || ''));
      } else if (act === 'listen-answer') {
        openAudioPlayer(id, !!state.audioReady[id]);
      } else if (act === 'generate-audio') {
        openAudioPlayer(id, false);
        await generateAnswerAudio(id);
      } else if (act === 'play-audio') {
        openAudioPlayer(id, true);
      } else if (act === 'device-audio') {
        startDeviceSpeech(id);
      } else if (act === 'retry') { streamRequest('/api/messages/' + id + '/retry', { response_detail: state.responseDetail }); }
      else if (act === 'continue') { streamRequest('/api/messages/' + id + '/continue', { response_detail: state.responseDetail }); }
      else if (act === 'stop') { await api.post('/api/messages/' + id + '/stop'); }
      else if (act === 'rate-up') { await rateMessage(id, 1); }
      else if (act === 'rate-down') { await rateMessage(id, -1); }
      else if (act === 'delete') { await deleteMessage(id); }
      else if (act === 'save') {
        const n = findNode(state.tree, id);
        if (n) {
          const el = $('.msg[data-mid="' + id + '"] .content');
          openSaveMenu({
            title: (state.chats.find(c => c.id === state.currentChatId) || {}).title || 'AI CH',
            text: n.content || '',
            html: el ? el.innerHTML : '',
          });
        }
      } else if (act === 'expand') {
        const n = findNode(state.tree, id);
        if (n) { n.showFull = true; renderMessages(); }
      } else if (act === 'memory') { await openMemory(id); }
      else if (act === 'sources') {
        const n = findNode(state.tree, id);
        if (n) openSources(n.sources || []);
      }
      });
    }

    $$('[data-activity-full]', scope).forEach(button => button.addEventListener('click', () => {
      openActivityStream(button.dataset.activityFull);
    }));
    $$('[data-activity-toggle]', scope).forEach(button => button.addEventListener('click', () => {
      const n = findNode(state.tree, button.dataset.activityToggle);
      if (!n) return;
      n.showActivities = !n.showActivities;
      renderMessageInPlace(n.id);
    }));

    $$('[data-fallback-code-toggle]', scope).forEach(button => button.addEventListener('click', () => {
      const n = findNode(state.tree, button.dataset.fallbackCodeToggle);
      if (!n) return;
      const runs = Array.isArray(n.tool_runs) ? n.tool_runs : [];
      const run = runs.slice().reverse().find(isDeviceFallbackRun);
      if (!run) return;
      const code = run.kind === 'fileplan' ? deviceCodeForFilePlan(run.device_plan) : String(run.code || '');
      if (!code.trim()) return;
      openFallbackCodeViewer(code, 'python');
    }));

    $$('[data-open-device-status]', scope).forEach(button => button.addEventListener('click', () => {
      openDeviceRunnerStatus(button.dataset.openDeviceStatus);
    }));

    $$('[data-web-images-toggle]', scope).forEach(button => button.addEventListener('click', () => {
      const section = button.closest('.aich-web-images');
      if (!section) return;
      const expanded = section.classList.toggle('is-collapsed') === false;
      button.setAttribute('aria-expanded', String(expanded));
      button.innerHTML = icon('image') +
        '<span>' + (expanded ? 'Скрыть изображения из интернета' : 'Показать изображения из интернета') + '</span>' +
        icon(expanded ? 'chevron-up' : 'chevron-down');
    }));

    $$('[data-code-toggle]', scope).forEach(button => button.addEventListener('click', () => {
      const block = button.closest('.code-block');
      if (!block) return;
      const preview = $('.code-preview', block);
      const full = $('.code-full', block);
      if (!preview || !full) return;
      const expanded = full.hidden;
      preview.hidden = expanded;
      full.hidden = !expanded;
      block.classList.toggle('is-expanded', expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.title = expanded ? 'Свернуть код' : 'Развернуть код';
      button.innerHTML = icon(expanded ? 'chevron-up' : 'chevron-down') +
        '<span>' + (expanded ? 'Свернуть' : 'Развернуть') + '</span>';
    }));

    $$('[data-preview-run]', scope).forEach(button => button.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[button.dataset.previewRun];
      const preview = button.closest('.html-preview');
      const frame = preview ? $('iframe', preview) : null;
      if (!rec || typeof rec.code !== 'string' || !frame) {
        toast('Код для HTML-превью не найден.', 'error');
        return;
      }
      frame.srcdoc = rec.code + '\n<!-- AI_CH_PREVIEW_RELOAD:' + Date.now() + ' -->';
      button.blur();
    }));

    $$('[data-copy]', scope).forEach(b => b.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[b.dataset.copy];
      copyWithFeedback(b, rec ? rec.code : '');
    }));

    $$('[data-dl]', scope).forEach(b => b.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[b.dataset.dl];
      if (rec) openSaveMenu({ title: 'Код', text: rec.code, lang: rec.lang, svg: false });
    }));

    $$('[data-run-file-block]', scope).forEach(button => button.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[button.dataset.runFileBlock];
      const code = rec && typeof rec.code === 'string' ? rec.code.trim() : '';
      if (!code) { toast('Код для создания файла не найден.', 'error'); return; }
      const message = button.closest('.msg');
      const messageId = message && message.dataset ? message.dataset.mid : null;
      // Explicitly marked artifact code runs in the device sandbox only after a click.
      openDeviceCodeRunner({ lang: 'run', code }, typeof messageId === 'string' ? messageId : null);
    }));

    $$('[data-dl-table]', scope).forEach(b => b.addEventListener('click', () => {
      const rows = (window.__tableStore || {})[b.dataset.dlTable];
      if (!rows) return;
      openTableMenu(rows);
    }));

  }

  function scrollToBottom() {
    const box = $('#messages');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    state.stickBottom = true;
    updateScrollDownButton();
  }

  function updateScrollDownButton() {
    const button = $('#scroll-to-bottom-btn');
    const box = $('#messages');
    if (!button || !box) return;
    const hasAnswer = allMessages(state.tree).some(entry => {
      const node = entry && entry.node;
      return !!(node && node.role === 'assistant' && String(node.content || '').trim());
    });
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    const visible = hasAnswer && !box.classList.contains('empty') && distanceFromBottom > 70;
    button.classList.toggle('hidden', !visible);
    button.setAttribute('aria-hidden', String(!visible));
    button.tabIndex = visible ? 0 : -1;
    const composer = $('#composer');
    button.style.bottom = Math.ceil((composer ? composer.getBoundingClientRect().height : 0) + 12) + 'px';
  }

  function scrollToMessageStart(messageId) {
    const box = $('#messages');
    if (!box || messageId == null) return;
    const target = $$('.msg', box).find(el => el.dataset.mid === String(messageId));
    if (!target) return;
    const boxTop = box.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const top = Math.max(0, box.scrollTop + targetTop - boxTop - 4);
    state.stickBottom = false;
    box.scrollTo({ top, behavior: 'smooth' });
  }

  function maybeScroll() {
    if (state.stickBottom !== false) scrollToBottom();
  }

  function bindStreamRefs() {
    const el = state.activeAssistantId
      ? $('.msg[data-mid="' + state.activeAssistantId + '"]')
      : null;
    state.streamEl = el ? $('.content', el) : null;
    state.thinkBody = el ? $('.think-tail', el) : null;
    state.draftTail = el ? $('.think-tail.answer', el) : null;
  }

  async function rateMessage(id, rating) {
    const n = findNode(state.tree, id);
    const next = n && n.rating === rating ? 0 : rating;
    try {
      await api.post('/api/messages/' + id + '/rate', { rating: next });
      if (n) n.rating = next;
      renderMessages();
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
  }

  function removeFromTree(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (removeFromTree(nodes[i].children || [], id)) return true;
    }
    return false;
  }

  async function deleteMessage(id) {
    const n = findNode(state.tree, id);
    const many = n && n.children && n.children.length;
    if (!confirm(many ? 'Удалить этот ответ и все вложенные сообщения?' : 'Удалить это сообщение?')) return;
    try {
      await api.del('/api/messages/' + id);
      removeFromTree(state.tree, id);
      renderMessages();
      loadUsage();
      toast('Удалено');
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
  }

  // ---------- streaming ----------
  async function consumeSse(res, onEvent) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        chunk.split('\n').forEach(line => {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        });
        if (data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { /* noop */ } }
      }
    }
  }


  function setStreaming(on) {
    state.streaming = on;
    if (on) {
      state.generatingChatId = state.currentChatId || '';
      const activeChat = (state.chats || []).find(item => item && item.id === state.generatingChatId);
      if (activeChat) activeChat.is_generating = true;
    } else {
      const completedChat = (state.chats || []).find(item => item && item.id === state.generatingChatId);
      if (completedChat) completedChat.is_generating = false;
      state.generatingChatId = '';
    }
    refreshCurrentChatTitle();
    renderChatList();
    const sendButton = $('#send-btn');
    if (sendButton) sendButton.disabled = !!(on || state.sending || state.chatLoading);
    $('#send-btn').classList.remove('hidden');
    $('#stop-btn').classList.toggle('hidden', !on);
    $('#input').disabled = false;
    updateComposerActionButton();
  }

  async function streamRequest(path, body, opts) {
    // opts: { optimistic: true } — a pending assistant bubble was already
    // rendered by the caller; don't block on it and don't reset the tree ids
    if (state.streaming) return;
    setStreaming(true);
    if (!opts || !opts.optimistic) {
      state.activeAssistantId = null;
    }
    const streamContext = {
      startChatId: state.currentChatId,
      chatId: state.currentChatId,
      startChatOpenToken: state.chatOpenToken,
      assistantId: null,
      node: null,
      renderFrame: 0,
      pendingRenderNode: null,
      statusTimer: null,
      previewStatuses: [],
      previewStatusIndex: 0,
    };
    const stopPreviewStatuses = () => {
      if (streamContext.statusTimer) {
        window.clearInterval(streamContext.statusTimer);
        streamContext.statusTimer = null;
      }
    };
    const flushPendingDeltaRender = () => {
      if (streamContext.renderFrame) {
        cancelAnimationFrame(streamContext.renderFrame);
        streamContext.renderFrame = 0;
      }
      const pendingNode = streamContext.pendingRenderNode;
      streamContext.pendingRenderNode = null;
      if (!pendingNode) return;
      renderActivityPopup(pendingNode);
      if (state.currentChatId === streamContext.chatId && streamContext.assistantId) {
        renderMessageInPlace(streamContext.assistantId);
        bindStreamRefs();
      }
      maybeScroll();
    };
    const scheduleDeltaRender = (node) => {
      if (node) streamContext.pendingRenderNode = node;
      if (streamContext.renderFrame) return;
      streamContext.renderFrame = requestAnimationFrame(() => {
        streamContext.renderFrame = 0;
        flushPendingDeltaRender();
      });
    };
    window.__aichActiveStream = streamContext;
    state.streamEl = null; state.thinkBody = null; state.draftTail = null;
    state.streamBuf = ''; state.streamStarted = false;
    streamContext.startedAt = Date.now();
    state.genStart = streamContext.startedAt;
    state.lastEvent = Date.now();
    if (state.genTimer) clearInterval(state.genTimer);
    state.genTimer = setInterval(() => {
      // the limit bar fills live while the answer is still streaming;
      // the exact dollar amount lands on `done` (server bills per model)
      const w = windowUsage();
      if (w && w.budget_usd !== null && w.budget_usd !== undefined) {
        const outTokens = Math.round(((state.streamBuf || '').length) / 3.6);
        const live = Number(w.spend_usd || 0);
        paintUsage(w.budget_usd > 0 ? live / w.budget_usd * 100 : 100,
          'Идёт генерация · ' + outTokens.toLocaleString('ru-RU') +
          ' ток. выхода · бюджет $' + live.toFixed(4) + ' из $' + w.budget_usd +
          ' за ' + w.hours + ' ч');
      }
      const elapsedNode = state.activeAssistantId ? findNode(state.tree, state.activeAssistantId) : null;
      const liveStream = window.__aichActiveStream;
      const liveNode = liveStream && liveStream.node ? liveStream.node : elapsedNode;
      if (liveNode && !['completed', 'failed', 'cancelled'].includes(liveNode.status)) {
        renderActivityPopup(liveNode);
      }
      const elapsedEl = elapsedNode
        ? $$('[data-activity-elapsed]').find(el => String(el.dataset.activityElapsed) === String(elapsedNode.id))
        : null;
      if (elapsedEl && elapsedNode && state.currentChatId === streamContext.chatId &&
          !['completed', 'failed', 'cancelled'].includes(elapsedNode.status)) {
        elapsedEl.innerHTML = latestActivityEmojiHtml(elapsedNode) + ' ' + escapeHtml(latestActivityLabel(elapsedNode));
      }
    }, 1000);
    const controller = new AbortController();
    let watchdog = null;
    let watchdogExpired = false;
    let responseReceived = false;
    let budgetModalShown = false;
    const maybeOpenBudgetModal = (value) => {
      if (budgetModalShown) return;
      let text = '';
      try {
        text = typeof value === 'string' ? value : JSON.stringify(value == null ? '' : value);
      } catch (_) {
        text = String(value == null ? '' : value);
      }
      // Parse JSON-wrapped HTTP errors as well as plain SSE messages. Only a
      // depleted dollar budget opens this window; unrelated quota errors remain errors.
      const fragments = [text];
      let parsed = value;
      for (let depth = 0; depth < 3; depth += 1) {
        if (typeof parsed !== 'string') {
          try { parsed = JSON.stringify(parsed); } catch (_) { parsed = String(parsed); }
          if (parsed) fragments.push(parsed);
        }
        if (typeof parsed !== 'string') break;
        try {
          parsed = JSON.parse(parsed);
          if (parsed && typeof parsed === 'object') {
            ['detail', 'error', 'message', 'description'].forEach(key => {
              if (parsed[key] !== undefined) {
                try { fragments.push(typeof parsed[key] === 'string' ? parsed[key] : JSON.stringify(parsed[key])); }
                catch (_) { fragments.push(String(parsed[key])); }
              }
            });
          }
        } catch (_) { break; }
      }
      const diagnostic = fragments.filter(Boolean).join('\n');
      const isMoneyBudget = (
        (/лимит\s+(?:тарифа\s+)?исчерпан/i.test(diagnostic) &&
          /(?:\$|денежн|бюджет|budget|spent|расход)/i.test(diagnostic)) ||
        /денежн[а-яё\s-]{0,30}бюджет[а-яё\s-]{0,30}(?:исчерпан|превышен)|бюджет[а-яё\s-]{0,40}(?:исчерпан|превышен)|budget[\s_-]{0,40}(?:exhausted|exceeded)/i.test(diagnostic)
      );
      if (!isMoneyBudget) return false;
      budgetModalShown = true;
      openUsageModal({ exhausted: true, refresh: true }).catch((e) => console.warn('Could not open subscription limits:', e));
      return true;
    };
    const armWatchdog = (delay) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        watchdogExpired = true;
        controller.abort();
      }, delay);
    };
    // The API should begin the SSE response promptly. Once connected, allow
    // longer model think time, but never leave the composer locked forever.
    armWatchdog(120000);
    try {
      const headers = { 'X-CSRF-Token': api.csrf() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(path, {
        method: 'POST', headers, credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401) { showAuth(); return; }
      if (!res.ok) { const t = await res.text(); throw new Error(t); }
      responseReceived = true;
      armWatchdog(330000);

      await consumeSse(res, (ev, data) => {
        armWatchdog(330000);
        state.lastEvent = Date.now();
        if (ev !== 'delta' && streamContext.pendingRenderNode) flushPendingDeltaRender();
        if (ev === 'chat_created') {
          // The combined endpoint tells the UI which chat now owns this stream.
          if (data && typeof data === 'object' && data.id) {
            streamContext.chatId = data.id;
            const ownsOpenView = state.chatOpenToken === streamContext.startChatOpenToken &&
              (state.currentChatId === streamContext.startChatId ||
                (!streamContext.startChatId && !state.currentChatId));
            data.is_generating = true;
            upsertChat(data);
            state.generatingChatId = data.id;
            const activeNewChat = state.chats.find(item => item && item.id === data.id);
            if (activeNewChat) activeNewChat.is_generating = true;
            if (!streamContext.startChatId && pendingNewChatProjectId && String(data.project_id || '') === pendingNewChatProjectId) {
              pendingNewChatProjectId = '';
              pendingNewChatProjectLabel = '';
              renderAddChatActionLabels();
            }
            renderChatList();
            if (ownsOpenView) {
              state.currentChatId = data.id;
              updateShareButtonVisibility();
              refreshCurrentChatTitle(data.title || 'Новый чат');
            }
          }
        } else if (ev === 'user_message' || ev === 'assistant_message') {
          const tmp = ev === 'user_message' ? state.tmpUser : state.tmpAssistant;
          const previousId = tmp && tmp.id;
          if (ev === 'assistant_message') streamContext.assistantId = data && data.id ? data.id : null;
          if (state.currentChatId !== streamContext.chatId) {
            if (ev === 'assistant_message') {
              streamContext.node = Object.assign({}, data, { children: [], activities: [] });
              streamContext.node.creating = true;
              streamContext.node.activityStartedAt = state.genStart || Date.now();
              window.__aichActivityNodes = window.__aichActivityNodes || Object.create(null);
              window.__aichActivityNodes[streamContext.node.id] = streamContext.node;
            }
            return;
          }
          let node = null;
          let replacedOptimistic = false;
          if (tmp) {
            // Replace only the optimistic bubble; keep the rest of the conversation mounted.
            node = findNode(state.tree, tmp.id);
            if (node) {
              const parentId = data.parent_message_id || node.parent_message_id;
              Object.assign(node, data, { children: node.children || [] });
              if (parentId) node.parent_message_id = parentId;
              replacedOptimistic = true;
            }
          }
          if (!node) node = insertMessage(state.tree, data);
          if (ev === 'assistant_message') {
            streamContext.assistantId = node.id;
            streamContext.node = node;
            node.creating = true;
            node.activityStartedAt = Number(node.activityStartedAt) || streamContext.startedAt || Date.now();
            state.activeAssistantId = node.id;
            window.__aichActivityNodes = window.__aichActivityNodes || Object.create(null);
            window.__aichActivityNodes[node.id] = node;
            const liveIds = Object.keys(window.__aichActivityNodes);
            if (liveIds.length > 40) liveIds.slice(0, liveIds.length - 40).forEach(key => delete window.__aichActivityNodes[key]);
          }
          if (replacedOptimistic) {
            if (previousId && previousId !== node.id && window.__aichActivityWindows &&
                window.__aichActivityWindows[previousId]) {
              window.__aichActivityWindows[node.id] = window.__aichActivityWindows[previousId];
              delete window.__aichActivityWindows[previousId];
            }
            if (previousId && previousId !== node.id && window.__aichActivityNodes) {
              delete window.__aichActivityNodes[previousId];
            }
            renderMessageInPlace(node.id, previousId);
            if (window.__aichActivityWindows && window.__aichActivityWindows[node.id]) renderActivityPopup(node);
          } else {
            renderMessages();
          }
          if (ev === 'assistant_message') bindStreamRefs();
        } else if (ev === 'status_preview') {
          const statuses = Array.isArray(data.statuses) ? data.statuses : [];
          if (streamContext.node && statuses.length) {
            const selectedEmoji = String(data.emoji || '✨');
            streamContext.statusEmoji = selectedEmoji;
            streamContext.node.statusModelEmoji = selectedEmoji;
            stopPreviewStatuses();
            streamContext.previewStatuses = statuses.slice(0, 60);
            streamContext.previewStatusIndex = 0;
            const showNextPreviewStatus = () => {
              if (!streamContext.node || !streamContext.previewStatuses.length) {
                stopPreviewStatuses();
                return;
              }
              if (streamContext.previewStatusIndex >= streamContext.previewStatuses.length) {
                stopPreviewStatuses();
                return;
              }
              const item = streamContext.previewStatuses[streamContext.previewStatusIndex++];
              const statusText = typeof item === 'string' ? item : String(item && item.text || '');
              if (statusText.trim()) {
                const n = (state.currentChatId === streamContext.chatId
                  ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
                // Keep the current model-generated status separate from transport/stage events.
                n.statusModelCurrent = stripActivityEmoji(statusText);
                n.statusModelEmoji = streamContext.statusEmoji || '✨';
                streamContext.node.statusModelCurrent = n.statusModelCurrent;
                streamContext.node.statusModelEmoji = n.statusModelEmoji;
                appendActivity(n, { kind: 'status', text: n.statusModelCurrent });
                if (state.currentChatId === streamContext.chatId) {
                  renderMessageInPlace(streamContext.assistantId);
                  bindStreamRefs();
                }
              }
            };
            showNextPreviewStatus();
            streamContext.statusTimer = window.setInterval(showNextPreviewStatus, 2800);
          }
        } else if (ev === 'status_stop') {
          stopPreviewStatuses();
        } else if (ev === 'deep_research') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n && data && Array.isArray(data.agents)) {
            const existingRuns = Array.isArray(n.tool_runs) ? n.tool_runs : [];
            const preservedRuns = existingRuns.filter(run => run && !String(run.kind || '').startsWith('deep_research_'));
            n.tool_runs = preservedRuns.concat(data.flow && data.flow.kind === 'deep_research_flow' ? [data.flow] : [], data.agents);
            const activeAgents = data.agents.filter(agent => ['queued', 'working', 'searching'].includes(String(agent.status || '')));
            if (activeAgents.length) {
              const current = activeAgents.find(agent => agent.status === 'searching') || activeAgents[0];
              appendActivity(n, { kind: 'status', text: String(current.name || 'Агент') + ': ' + deepResearchStatusLabel(current.status) });
            }
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(streamContext.assistantId);
              bindStreamRefs();
            }
          }
        } else if (ev === 'stage') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            n.stage = data.stage || '';
            // Do not replace status-model progress with generic transport labels.
            renderActivityPopup(n);
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(streamContext.assistantId);
              bindStreamRefs();
            }
          }
        } else if (ev === 'ui_status') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          const statusText = stripActivityEmoji(data.text || '');
          const genericTransportStatus = /^(?:думаю|передаю запрос|обрабатываю запрос|получаю ответ от модели|подготавливаю ответ|подбираю способ решения|ожидаю завершения предыдущего ответа)[.…! ]*$/iu;
          if (n && statusText && !genericTransportStatus.test(statusText.trim())) {
            appendActivity(n, { kind: 'status', text: statusText });
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(streamContext.assistantId);
              bindStreamRefs();
            }
          }
        } else if (ev === 'ui_action') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            appendActivity(n, { kind: 'action', icon: data.icon, text: data.text });
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(streamContext.assistantId);
              bindStreamRefs();
            }
          }
        } else if (ev === 'thinking') {
          // Provider-private reasoning is deliberately not rendered or copied into the UI.
        } else if (ev === 'delta') {
          const deltaText = data.text || '';
          state.streamBuf += deltaText;
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          const needsAnswerBody = !!(n && n.creating);
          if (n) {
            n.draft = state.streamBuf;
            n.publicStream = String(n.publicStream || '') + deltaText;
            n.creating = false;
            state.streamStarted = true;
            if (needsAnswerBody && state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(streamContext.assistantId);
              bindStreamRefs();
            } else {
              scheduleDeltaRender(n);
            }
          }
          if (state.currentChatId === streamContext.chatId && state.draftTail) {
            state.draftTail.textContent = tailText(state.streamBuf, 260);
          }
        } else if (ev === 'memory') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.memories = (n.memories || []).concat(data.items || []);
          loadMemory();
        } else if (ev === 'tool_start') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            const blockKind = data.kind === 'fileplan' ? 'fileplan' : 'run';
            const planSource = typeof data.device_plan === 'string' ? data.device_plan : '';
            const deviceCode = blockKind === 'fileplan'
              ? (planSource ? deviceCodeForFilePlan(planSource) : '')
              : (typeof data.code === 'string' ? data.code : '');
            const item = { code: data.code || '', kind: blockKind, running: true, ok: true, files: [] };
            if (planSource) item.device_plan = planSource;
            n.tool_runs = (n.tool_runs || []).concat([item]);
            appendActivity(n, { kind: 'status', text: blockKind === 'fileplan' ? 'Подготавливаю файл' : 'Выполняю код для задачи' });
            if (n.execution_target === 'both' && !n.deviceRunnerStarted && deviceCode.trim()) {
              n.deviceRunnerStarted = true;
              appendActivity(n, { kind: 'status', text: 'Параллельно запускаю код на устройстве' });
              openDeviceCodeRunner({ lang: 'run', code: deviceCode }, n.id, { background: true });
            }
          }
          if (state.currentChatId === streamContext.chatId) {
            renderMessageInPlace(streamContext.assistantId);
            bindStreamRefs();
          }
          if (isCurrentCodeAgent()) setProjectStatus('Готовлю файлы проекта…');
          else appendLog(blockKind === 'fileplan' ? '▶ Создаю файл…' : '▶ Выполняю код…');
        } else if (ev === 'tool') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            const runs = Array.isArray(n.tool_runs) ? n.tool_runs : [];
            const idx = runs.findIndex(r => r && r.running);
            const previousRun = idx >= 0 ? runs[idx] : null;
            const hasLocalFallback = isDeviceFallbackRun(data);
            const hasPreviousLocalFallback = isDeviceFallbackRun(previousRun);
            const suppressSandboxFailure = (!data.ok || data.timed_out) && !isCurrentCodeAgent() && !hasLocalFallback && !hasPreviousLocalFallback;
            if (idx >= 0) {
              if (suppressSandboxFailure) runs.splice(idx, 1);
              else {
                const completedRun = Object.assign({}, previousRun || {}, data || {});
                completedRun.running = false;
                runs[idx] = completedRun;
              }
            } else if (!suppressSandboxFailure) {
              runs.push(data);
            }
            n.tool_runs = runs;
            if (data.files && data.files.length) {
              n.attachments = (n.attachments || []).concat(data.files.map(f => ({
                id: f.id, file_id: f.file_id, name: normaliseOutputFilename(f.name, ''),
                kind: f.kind, size: f.size,
              })));
              appendActivity(n, { kind: 'status', text: 'Файлы подготовлены · завершаю проверку результата' });
            } else if (suppressSandboxFailure) {
              appendActivity(n, { kind: 'status', text: 'Продолжаю подготовку результата' });
            } else {
              appendActivity(n, { kind: 'status', text: data.ok && !data.timed_out
                ? 'Результат выполнения готов · завершаю проверку' : 'Продолжаю обработку результата' });
            }
          }
          if (state.currentChatId === streamContext.chatId) {
            renderMessageInPlace(streamContext.assistantId);
            bindStreamRefs();
          }
          if (isCurrentCodeAgent()) {
            if (!data.ok || data.timed_out) {
              setProjectStatus('Проверяю результат и исправляю обнаруженную проблему…');
            } else if (data.files && data.files.length) {
              setProjectStatus('Файлы проекта подготовлены; завершаю проверку…');
            } else {
              setProjectStatus('Проверяю и оформляю результат…');
            }
          } else {
            if (data.kind !== 'fileplan' && data.stderr && (!data.ok || data.timed_out)) {
              appendLog('! ' + String(data.stderr).trim().slice(0, 2000));
            }
            if (data.files && data.files.length) {
              appendLog('✓ файлы: ' + data.files.map(f => f.name).join(', '));
            }
          }
          loadProject(false);
        } else if (ev === 'step') {
          state.streamBuf = '';
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.draft = '';
          renderMessageInPlace(state.activeAssistantId);
          bindStreamRefs();
        } else if (ev === 'ask') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            n.ask = Array.isArray(data.questions) ? data.questions
              : (data.question ? [{ question: data.question, options: [] }] : []);
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(n.id);
              bindStreamRefs();
            }
          }
        } else if (ev === 'quiz') {
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            n.quiz = Array.isArray(data.questions) ? data.questions : [];
            n.quizCollapsed = Array.isArray(data.questions) && data.questions.length > 2;
            n.quizSubmitted = false;
            n.quizAnswers = [];
            n.quizCustom = [];
            if (state.currentChatId === streamContext.chatId) {
              renderMessageInPlace(n.id);
              bindStreamRefs();
            }
          }
        } else if (ev === 'done') {
          stopPreviewStatuses();
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, data.message_id || streamContext.assistantId) : null) || streamContext.node;
          const completeAnswer = String((data && data.text) || state.streamBuf || '');
          const deviceFileRun = extractAutoDeviceFileRun(completeAnswer);
          if (n) {
            n.status = 'completed';
            n.content = deviceFileRun ? deviceFileRun.visible : completeAnswer;
            n.draft = ''; n.creating = false;
            if (deviceFileRun && !n.deviceRunnerStarted) {
              n.tool_runs = (Array.isArray(n.tool_runs) ? n.tool_runs : []).concat([{
                code: deviceFileRun.code, kind: 'run', ok: false, timed_out: false, files: [], running: false,
              }]);
            }
            n.activityFinishedAt = Date.now();
            n.activityElapsedMs = Math.max(0, n.activityFinishedAt - activityStartTime(n));
            saveActivityItems(n);
            renderActivityPopup(n);
          }
          if (n && deviceFileRun && !n.deviceRunnerStarted) {
            n.deviceRunnerStarted = true;
            n.deviceRunnerStatus = 'Ответ завершён. Подготавливаю файл на устройстве…';
            n.deviceRunnerError = null;
            if (state.currentChatId === streamContext.chatId) renderMessageInPlace(n.id);
            toast('Ответ завершён. Подготавливаю файл на устройстве…');
            openDeviceCodeRunner({ lang: 'run', code: deviceFileRun.code }, n.id, { background: true });
          }
          if (n && state.currentChatId === streamContext.chatId) {
            renderMessageInPlace(n.id, null, { focusMessageId: n.id });
            const entries = allMessages(state.tree);
            hydrateAudioStatuses(entries);
            hydrateReadableTextStatuses(entries);
          }
          loadUsage();
        } else if (ev === 'error') {
          stopPreviewStatuses();
          maybeOpenBudgetModal(data && (data.error || data.detail || data));
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, data.message_id || streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            n.status = 'failed'; n.creating = false; n.error = data.error;
            n.activityFinishedAt = Date.now();
            n.activityElapsedMs = Math.max(0, n.activityFinishedAt - activityStartTime(n));
            saveActivityItems(n);
            renderActivityPopup(n);
            if (state.currentChatId === streamContext.chatId) renderMessageInPlace(n.id);
          }
        } else if (ev === 'cancelled') {
          stopPreviewStatuses();
          const n = (state.currentChatId === streamContext.chatId
            ? findNode(state.tree, data.message_id || streamContext.assistantId) : null) || streamContext.node;
          if (n) {
            n.status = 'cancelled'; n.creating = false; if (data.text) n.content = data.text;
            n.activityFinishedAt = Date.now();
            n.activityElapsedMs = Math.max(0, n.activityFinishedAt - activityStartTime(n));
            saveActivityItems(n);
            renderActivityPopup(n);
            if (state.currentChatId === streamContext.chatId) renderMessageInPlace(n.id);
          }
        }
      });
    } catch (err) {
      console.error(err);
      const budgetLimitReached = maybeOpenBudgetModal(err && err.message ? err.message : err);
      const friendlyError = watchdogExpired
        ? (responseReceived
          ? 'Ответ остановился без новых событий более 330 секунд. Можно отправить запрос ещё раз.'
          : 'Сервер не начал ответ за 120 секунд. Текст запроса сохранён — попробуйте ещё раз.')
        : usefulErrorMessage(err, 'Неизвестная ошибка при отправке запроса');
      if (!responseReceived && opts && opts.optimistic && opts.input) {
        restoreUnsentDraft(opts.input, opts.draft || '');
        const unsent = Array.isArray(opts.attachments) ? opts.attachments : [];
        if (unsent.length) {
          const currentAttachments = Array.isArray(state.pendingAttachments)
            ? state.pendingAttachments.filter(f => f && typeof f === 'object' && typeof f.id === 'string' && f.id)
            : [];
          const present = new Set(currentAttachments.map(f => f.id));
          state.pendingAttachments = unsent
            .filter(f => f && typeof f === 'object' && typeof f.id === 'string' && f.id && !present.has(f.id))
            .concat(currentAttachments);
          renderAttachments();
        }
      }
      if (budgetLimitReached) {
        // Explain the exhausted budget in the subscription dialog instead of
        // stacking a red error toast and a failed optimistic message.
        [state.tmpUser, state.tmpAssistant].forEach(item => {
          if (item && item.id && /^tmp_/.test(String(item.id))) removeFromTree(state.tree, item.id);
        });
        state.activeAssistantId = null;
        renderMessages();
      } else {
        toast('Ошибка: ' + friendlyError, 'error');
        const a = state.activeAssistantId ? findNode(state.tree, state.activeAssistantId) : null;
        if (a && a.status !== 'completed' && a.status !== 'cancelled') {
          a.status = 'failed'; a.creating = false;
          a.error = (err && err.message) ? err.message : 'запрос не прошёл';
          renderMessages();
        }
        const ghost = state.tmpAssistant ? findNode(state.tree, state.tmpAssistant.id) : null;
        if (ghost && /^tmp_/.test(ghost.id) && state.currentChatId) {
          const recoveryChatId = state.currentChatId;
          openChat(recoveryChatId).catch((e) => console.warn('Chat recovery failed:', e));
        }
      }
      state.tmpUser = null; state.tmpAssistant = null;
    } finally {
      stopPreviewStatuses();
      if (streamContext.pendingRenderNode) flushPendingDeltaRender();
      if (watchdog) clearTimeout(watchdog);
      if (window.__aichActiveStream === streamContext) window.__aichActiveStream = null;
      setStreaming(false);
      // Limits and sidebar refresh happen in the background and cannot hold the
      // send controls hostage if a secondary endpoint is slow.
      setTimeout(async () => {
        try {
          await loadLimits();
          await loadUsage();
          const w = windowUsage();
          const budget = Number(w && w.budget_usd);
          const spent = Number(w && w.spend_usd || 0);
          // Open the subscription offer as soon as the rolling dollar budget is
          // reached, including the exact boundary (e.g. Free: $1.00 of $1.00).
          if (!budgetModalShown && w && Number.isFinite(budget) && Number.isFinite(spent) && spent >= budget) {
            budgetModalShown = true;
            await openUsageModal({ exhausted: true });
          }
        } catch (e) {
          console.warn('Limits refresh failed:', e);
        }
      }, 250);
      if (state.genTimer) { clearInterval(state.genTimer); state.genTimer = null; }
      state.streamEl = null;
      loadChats().catch((e) => console.warn('Chat list refresh failed:', e));
      // refresh title (generated in background)
      if (streamContext.chatId) {
        const completedChatId = streamContext.chatId;
        const selectedToken = state.chatOpenToken;
        api.get('/api/chats/' + encodeURIComponent(completedChatId) + '/messages').then((loadedTree) => {
          if (state.currentChatId === completedChatId && state.chatOpenToken === selectedToken) {
            state.tree = Array.isArray(loadedTree) ? loadedTree : [];
            renderMessages();
          }
        }).catch((e) => console.warn('Completed stream refresh failed:', e));
        setTimeout(async () => {
          try {
            const chat = await api.get('/api/chats/' + encodeURIComponent(completedChatId));
            const i = state.chats.findIndex(c => c.id === chat.id);
            if (i >= 0 && state.chats[i].title !== chat.title) {
              state.chats[i] = chat; renderChatList();
              if (state.currentChatId === completedChatId) refreshCurrentChatTitle(chat.title);
            }
          } catch (e) { /* noop */ }
        }, 2500);
      }
    }
  }

  function usefulErrorMessage(err, fallback) {
    const raw = err && typeof err.message === 'string' ? err.message : (typeof err === 'string' ? err : '');
    const value = raw.trim();
    if (!value || value === 'null' || value === 'undefined' || value === '[object Object]') {
      return fallback || 'Неизвестная ошибка сервера';
    }
    return value;
  }

  function setSendPreparing(on) {
    const btn = $('#send-btn');
    if (!btn) return;
    btn.disabled = !!(on || state.chatLoading);
    btn.classList.toggle('preparing', !!on);
    btn.setAttribute('aria-busy', String(!!on));
    btn.title = on ? 'Подготавливаю запрос…' : 'Отправить';
  }

  function restoreUnsentDraft(input, draft) {
    if (!input) return;
    const current = input.value || '';
    if (!current.trim()) {
      input.value = draft;
    } else if (current !== draft && !current.includes(draft)) {
      // Preserve both the failed request and any text typed while it was being prepared.
      input.value = draft + '\n\n' + current;
    }
    autoGrow();
    input.focus();
  }

  function shouldAskExecutionTarget(text) {
    const value = String(text || '');
    const hasFence = value.indexOf(String.fromCharCode(96).repeat(3)) >= 0;
    const refersToCode = /python|javascript|typescript|\bjs\b|html|css|script|код|скрипт|программ|приложени|сайт|страниц|алгоритм|файл|артефакт|документ|document|презентац|presentation|spreadsheet|таблиц|excel|powerpoint|word|xlsx?|pptx?|docx?|pdf|svg|png|csv|json|markdown|\bmd\b|\btxt\b|график|диаграм|изображени|инфограф/i.test(value);
    const asksForCodeWork = /run|execute|compile|test|debug|write|create|generate|fix|build|implement|напиш|созда|сгенер|исправ|сделай|сформир|состав|нужн|хочу|пришли|подготов|оформи|собери|экспортиру|сохрани|конвертиру|преобраз|выгруз|разработ|построй|запуст|выполн|исполн|скомпили|протест|отлад|реализ|проверь/i.test(value);
    // Ask before generating code, including broad requests like "make an HTML game".
    // A pasted fenced snippet is also a code-execution intent even without an imperative.
    return (asksForCodeWork && refersToCode) || (hasFence && refersToCode);
  }

  async function sendCurrent(executionTarget) {
    const input = $('#input');
    if (!input) return;
    if (!state.identityReady) { toast('Подключаем сессию…', 'info'); return; }
    const draft = input.value;
    const content = draft.trim();
    if (!content || state.streaming || state.sending || state.chatLoading) return;
    const asksForArtifact = /(?:файл|документ|презентац|таблиц|excel|powerpoint|word|xlsx?|pptx?|docx?|pdf|svg|png|csv|json|markdown|\bmd\b|\btxt\b|отч[её]т|инфограф|диаграмм|изображени|картинк|иллюстрац|обложк|постер|presentation|spreadsheet|report)/i.test(content) &&
      /(?:созда|сгенер|подготов|сделай|сформир|состав|собери|пришли|выгруз|экспорт|запиши|сохрани|конверт|преобраз|нарисуй|построй|оформи|генер|разработ|нужн|хочу|create|generate|prepare|make|build|export|save|convert|draw|render)/i.test(content);
    // File creation is serialized: let the server try first when enabled, then use the device only if needed.
    // Target "both" would launch the browser runner on tool_start and create duplicate files.
    const selectedExecutionTarget = asksForArtifact
      ? 'site'
      : (executionTarget || (shouldAskExecutionTarget(content) ? 'both' : 'site'));

    // Validate pending attachments before reading IDs; a stale/null item must not abort sending.
    const pending = Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [];
    state.pendingAttachments = pending;
    const hasInvalidAttachment = pending.some(f =>
      !f || typeof f !== 'object' || typeof f.id !== 'string' || !f.id
    );
    if (hasInvalidAttachment) {
      state.pendingAttachments = pending.filter(f =>
        f && typeof f === 'object' && typeof f.id === 'string' && f.id
      );
      renderAttachments();
      toast('Одно из вложений устарело. Прикрепите этот файл заново; текст запроса сохранён.', 'error');
      return;
    }
    // Freeze the current attachment selection; new attachments stay for the next message.
    const sentAttachments = pending.slice();
    const attachments = sentAttachments.map(f => f.id);
    const attList = sentAttachments.map(f => ({
      file_id: f.id, name: f.original_name || f.name || 'файл',
      kind: f.kind || 'other', size: f.size || 0,
    }));
    const isNewChat = !state.currentChatId;

    state.sending = true;
    setSendPreparing(true);
    let requestStarted = false;
    try {
      // Create the chat and send its first message via one request.
      if (isNewChat) {
        state.tree = [];
        state.choices = {};
      }
      const path = activePath(state.tree, state.choices);
      const lastPathEntry = path.length ? path[path.length - 1] : null;
      const parentId = !isNewChat && lastPathEntry && lastPathEntry.node && lastPathEntry.node.id
        ? lastPathEntry.node.id
        : null;

      const userId = 'tmp_u_' + Date.now().toString(36);
      const asstId = 'tmp_a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const userNode = {
        id: userId, role: 'user', content, status: 'completed',
        parent_message_id: parentId, attachments: attList, children: [],
        created_at: new Date().toISOString(),
      };
      const asstNode = {
        id: asstId, role: 'assistant', content: '', status: 'processing',
        parent_message_id: userId, children: [],
        created_at: new Date().toISOString(),
        execution_target: selectedExecutionTarget,
        creating: true, creatingLabel: isNewChat ? 'Создаю чат и отправляю запрос…' : 'Запрос отправляется…',
        error: null,
      };
      const parentNode = parentId ? findNode(state.tree, parentId) : null;
      if (parentNode) {
        parentNode.children = parentNode.children || [];
        parentNode.children.push(userNode, asstNode);
      } else {
        state.tree.push(userNode, asstNode);
      }
      // A newly submitted prompt deliberately takes the reader to the new turn.
      state.stickBottom = true;
      state.activeAssistantId = asstId;
      renderMessages();

      const sentIds = new Set(attachments);
      state.pendingAttachments = state.pendingAttachments.filter(f => !sentIds.has(f.id));
      renderAttachments();

      state.tmpUser = { id: userId, content };
      state.tmpAssistant = { id: asstId };
      const endpoint = isNewChat
        ? '/api/new-chat/messages'
        : '/api/chats/' + encodeURIComponent(state.currentChatId) + '/messages';
      const request = streamRequest(endpoint, {
        content,
        parent_message_id: parentId,
        attachment_ids: attachments,
        model_set_id: state.modelSetId || null,
        project_id: isNewChat ? (pendingNewChatProjectId || null) : null,
        web_search: true,
        execution_target: selectedExecutionTarget,
        effort: state.effort,
        style: state.style,
        response_detail: state.responseDetail,
        deep_research: !!state.deepResearch,
      }, { optimistic: true, input, draft, attachments: sentAttachments });
      requestStarted = true;

      // Clear only after the network request has actually started. If it fails
      // before the SSE stream opens, streamRequest restores the text and files.
      if (input.value === draft) {
        input.value = '';
        autoGrow();
      }
      state.sending = false;
      setSendPreparing(false);
      await request;
      state.tmpUser = null;
      state.tmpAssistant = null;
    } catch (err) {
      console.error(err);
      const message = usefulErrorMessage(err, 'Неизвестная ошибка при подготовке запроса');
      if (!requestStarted) {
        if (!(input.value || '').trim()) restoreUnsentDraft(input, draft);
        toast('Не удалось начать отправку: ' + message + '. Текст сохранён.', 'error');
      } else {
        toast('Ошибка при отправке запроса: ' + message, 'error');
      }
      state.tmpUser = null;
      state.tmpAssistant = null;
    } finally {
      state.sending = false;
      setSendPreparing(false);
    }
  }

  // ---------- composer ----------
  function autoGrow() {
    const t = $('#input');
    if (!t) return;
    t.style.height = 'auto';
    const style = window.getComputedStyle(t);
    const lineHeight = Number.parseFloat(style.lineHeight) || 25;
    const padding = (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
    const maxHeight = Math.min(200, lineHeight * 4 + padding + 1);
    const contentHeight = t.scrollHeight;
    t.style.height = Math.min(contentHeight, maxHeight) + 'px';
    t.style.overflowY = contentHeight > maxHeight + 1 ? 'auto' : 'hidden';
    updateScrollDownButton();
  }

  function renderAttachments() {
    const box = $('#attach-list');
    if (!box) return;
    state.pendingAttachments = Array.isArray(state.pendingAttachments)
      ? state.pendingAttachments.filter(f => f && typeof f === 'object' && typeof f.id === 'string' && f.id)
      : [];
    box.innerHTML = state.pendingAttachments.map(f => {
      const id = String(f.id);
      const name = String(f.original_name || f.name || 'Файл').slice(0, 180);
      const mime = String(f.mime_type || f.mime || '').toLowerCase();
      const isSvg = /\.svg$/i.test(name) || mime === 'image/svg+xml';
      const isImage = isSvg || f.kind === 'image' || mime.startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|avif|bmp|tiff|ico)$/i.test(name);
      const previewUrl = isSvg
        ? '/api/files/' + encodeURIComponent(id) + '/download?inline=1'
        : '/api/files/' + encodeURIComponent(id) + '/thumbnail';
      const visual = isImage
        ? '<img class="attach-thumb" src="' + previewUrl +
          '" alt="" loading="lazy" decoding="async" />'
        : icon('file');
      return '<span class="attach-chip' + (isImage ? ' has-thumb' : '') + '" title="' +
        escapeHtml(name) + '">' + visual + '<span class="attach-name">' + escapeHtml(name) +
        '</span><button type="button" data-rm="' + escapeHtml(id) +
        '" title="Убрать" aria-label="Убрать ' + escapeHtml(name) + '">' + icon('x') +
        '</button></span>';
    }).join('');
    $$('[data-rm]', box).forEach(b => b.addEventListener('click', () => {
      state.pendingAttachments = state.pendingAttachments.filter(x => x.id !== b.dataset.rm);
      renderAttachments();
    }));
  }

  function responseDetailName(value) {
    return ({ minimum: 'Минимум', standard: 'Стандарт', max: 'Max' })[value] || 'Стандарт';
  }

  function renderAddChatResponseDetailView() {
    const root = $('#add-chat-response-detail-options');
    if (!root) return;
    const options = [
      { value: 'minimum', title: 'Минимум', description: 'Коротко и по делу, без лишних пояснений.' },
      { value: 'standard', title: 'Стандарт', description: 'Обычная глубина ответа по задаче. Выбрано по умолчанию.' },
      { value: 'max', title: 'Max', description: 'Больше деталей, объяснений, шагов и примеров.' },
    ];
    root.innerHTML = options.map(option => {
      const selected = state.responseDetail === option.value;
      return '<button type="button" class="response-detail-option' + (selected ? ' selected' : '') +
        '" role="radio" aria-checked="' + String(selected) + '" data-response-detail="' + option.value + '">' +
        '<span class="response-detail-option-copy"><strong>' + option.title + '</strong><small>' +
        option.description + '</small></span><span class="response-detail-option-check" aria-hidden="true">' +
        (selected ? icon('check') : '') + '</span></button>';
    }).join('');
  }

  function renderAddChatActionLabels() {
    const modelLabel = $('#add-chat-model-current');
    if (modelLabel) {
      const selected = (state.modelSets || []).find(item => item && item.id === state.modelSetId);
      modelLabel.textContent = selected ? selected.name : 'Модель по умолчанию';
    }
    const responseDetailLabel = $('#add-chat-response-detail-current');
    if (responseDetailLabel) responseDetailLabel.textContent = responseDetailName(state.responseDetail);
    const deepResearchButton = $('[data-add-chat-action="deep-research"]');
    const deepResearchLabel = $('#add-chat-deep-research-current');
    if (deepResearchButton) {
      deepResearchButton.classList.toggle('deep-research-selected', !!state.deepResearch);
      deepResearchButton.setAttribute('aria-pressed', String(!!state.deepResearch));
    }
    if (deepResearchLabel) deepResearchLabel.textContent = state.deepResearch ? 'Включён · до 5 агентов' : 'Выключен · до 5 агентов';
    const projectTitle = $('#add-chat-project-title');
    const projectLabel = $('#add-chat-project-current');
    const projectButton = $('#add-chat-project-action');
    if (!projectLabel || !projectTitle) return;
    if (state.currentChatId) {
      const chat = (state.chats || []).find(item => item && item.id === state.currentChatId);
      const projectId = String(chat && chat.project_id || '');
      const project = addChatProjects.find(item => String(item.id) === projectId);
      projectTitle.textContent = 'Изменить проект чата';
      projectLabel.textContent = projectId ? (project ? project.title || 'Выбранный проект' : 'Текущий проект') : 'Не добавлен в проект';
    } else {
      projectTitle.textContent = 'Добавить сразу в проект';
      projectLabel.textContent = pendingNewChatProjectId
        ? (pendingNewChatProjectLabel || 'Проект выбран для нового чата')
        : 'Не выбрано';
    }
    if (projectButton) projectButton.setAttribute('aria-label', projectTitle.textContent);
  }

  function renderAddChatLibraryFiles() {
    const box = $('#add-chat-library-list');
    if (!box) return;
    const query = String($('#add-chat-library-search')?.value || '').trim().toLocaleLowerCase('ru-RU');
    const files = (Array.isArray(state.files) ? state.files : []).filter(file =>
      file && file.id && (!query || String(file.original_name || '').toLocaleLowerCase('ru-RU').includes(query))
    );
    if (!files.length) {
      box.innerHTML = '<div class="add-chat-library-empty">' +
        (query ? 'По этому запросу файлов нет.' : 'В библиотеке пока нет файлов. Сначала добавьте их с устройства.') +
        '</div>';
      const count = $('#add-chat-library-selected-count');
      if (count) count.textContent = String(addChatSelectedFileIds.size);
      return;
    }
    box.innerHTML = files.map(file => {
      const id = String(file.id);
      const name = String(file.original_name || 'Файл');
      const checked = addChatSelectedFileIds.has(id);
      return '<label class="add-chat-library-item">' +
        '<input type="checkbox" data-library-file-id="' + escapeHtml(id) + '"' + (checked ? ' checked' : '') + ' />' +
        '<span class="add-chat-library-item-icon">' + icon(workspaceFileKind(file) === 'image' ? 'image' : 'file') + '</span>' +
        '<span class="add-chat-library-item-copy"><strong>' + escapeHtml(name) + '</strong><small>' +
        escapeHtml(workspaceFileKindLabel(workspaceFileKind(file))) + ' · ' + escapeHtml(formatSize(Number(file.size) || 0)) +
        (file.source === 'ai' ? ' · создан AI CH' : '') + '</small></span></label>';
    }).join('');
    const count = $('#add-chat-library-selected-count');
    if (count) count.textContent = String(addChatSelectedFileIds.size);
  }

  async function openAddChatLibrary() {
    setAddChatView('library');
    addChatSelectedFileIds = new Set();
    const box = $('#add-chat-library-list');
    if (box) box.innerHTML = '<div class="add-chat-library-empty">Загружаю файлы аккаунта…</div>';
    const search = $('#add-chat-library-search');
    if (search) search.value = '';
    try {
      const result = await api.get('/api/files');
      state.files = Array.isArray(result) ? result : [];
      renderFiles();
      renderFilesWorkspace();
      renderAddChatLibraryFiles();
    } catch (error) {
      if (box) box.innerHTML = '<div class="add-chat-library-empty">Не удалось загрузить файлы: ' +
        escapeHtml(usefulErrorMessage(error, 'ошибка загрузки')) + '</div>';
    }
  }

  function attachSelectedLibraryFiles() {
    const selected = new Set(addChatSelectedFileIds);
    const files = (Array.isArray(state.files) ? state.files : []).filter(file =>
      file && file.id && selected.has(String(file.id))
    );
    if (!files.length) {
      toast('Выберите файлы для добавления.', 'error');
      return;
    }
    const pending = new Map((Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [])
      .filter(file => file && file.id).map(file => [String(file.id), file]));
    let added = 0;
    files.forEach(file => {
      const id = String(file.id);
      if (!pending.has(id)) { pending.set(id, file); added += 1; }
    });
    state.pendingAttachments = Array.from(pending.values());
    renderAttachments();
    setAddChatView('main');
    toast(added ? (added === 1 ? 'Файл прикреплён к сообщению' : 'Файлы прикреплены к сообщению') : 'Выбранные файлы уже прикреплены');
  }

  function setAddChatView(view) {
    const shell = $('#add-to-chat-shell');
    const allowed = ['model', 'response-detail', 'memory', 'connectors', 'library', 'project', 'share', 'agent-detail'];
    const next = allowed.includes(view) ? view : 'main';
    addChatActiveView = next;
    const main = $('#add-chat-main-view');
    const model = $('#add-chat-model-view');
    const responseDetail = $('#add-chat-response-detail-view');
    const memory = $('#add-chat-memory-view');
    const connectors = $('#add-chat-connectors-view');
    const library = $('#add-chat-library-view');
    const project = $('#add-chat-project-view');
    const share = $('#add-chat-share-view');
    const agentDetail = $('#add-chat-agent-detail-view');
    if (main) main.classList.toggle('hidden', next !== 'main');
    if (model) model.classList.toggle('hidden', next !== 'model');
    if (responseDetail) responseDetail.classList.toggle('hidden', next !== 'response-detail');
    if (memory) memory.classList.toggle('hidden', next !== 'memory');
    if (connectors) connectors.classList.toggle('hidden', next !== 'connectors');
    if (library) library.classList.toggle('hidden', next !== 'library');
    if (project) project.classList.toggle('hidden', next !== 'project');
    if (share) share.classList.toggle('hidden', next !== 'share');
    if (agentDetail) agentDetail.classList.toggle('hidden', next !== 'agent-detail');
    if (shell) shell.classList.toggle('has-subview', next !== 'main');
    const title = $('#add-to-chat-title');
    if (title) title.textContent = next === 'model' ? 'Выбор модели'
      : next === 'response-detail' ? 'Как отвечать'
      : next === 'memory' ? 'Память и предпочтения'
      : next === 'connectors' ? 'Коннекторы'
      : next === 'library' ? 'Файлы аккаунта'
      : next === 'project' ? 'Добавить в проект'
      : next === 'share' ? 'Поделиться'
      : next === 'agent-detail' ? 'Результат агента' : 'Добавить в чат';
    const nav = $('#add-chat-nav');
    if (nav) {
      nav.innerHTML = next === 'main'
        ? '<svg class="ic"><use href="#i-x"/></svg><span class="add-chat-back-label">← Назад</span>'
        : '<span class="add-chat-back-label">← Назад</span>';
      nav.title = next === 'main' ? 'Закрыть' : 'Назад';
      nav.setAttribute('aria-label', next === 'main' ? 'Закрыть меню' : 'Назад');
    }
    const photos = $('[data-add-chat-action="photos"]');
    if (photos) photos.classList.toggle('hidden', next !== 'main');
    state.modelPickerOpen = next === 'model';
    renderModelPicker();
    if (next === 'response-detail') renderAddChatResponseDetailView();
    if (next === 'memory') renderAddChatMemoryView();
    if (next === 'connectors') renderConnectorsInto($('#add-chat-connectors-list'));
    if (next === 'main') renderAddChatActionLabels();
  }

  function openAddToChatSheet() {
    const shell = $('#add-to-chat-shell');
    if (!shell) { $('#file-input')?.click(); return; }
    const sheet = $('.add-to-chat-sheet', shell);
    // Each opening starts collapsed regardless of the previous gesture or subview.
    if (sheet) {
      sheet.classList.remove('is-expanded');
      sheet.scrollTop = 0;
      $$('.add-chat-sheet-content, .add-chat-subview', sheet).forEach(pane => { pane.scrollTop = 0; });
      sheet.style.removeProperty('height');
      sheet.style.removeProperty('max-height');
      sheet.style.removeProperty('transform');
      sheet.style.removeProperty('transition');
    }
    setAddChatView('main');
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    $('#attach-btn')?.classList.add('is-active');
    if (sheet) requestAnimationFrame(() => sheet.focus({ preventScroll: true }));
  }

  function closeAddToChatSheet() {
    const shell = $('#add-to-chat-shell');
    if (!shell) return;
    const sheet = $('.add-to-chat-sheet', shell);
    if (sheet) {
      sheet.classList.remove('is-expanded');
      sheet.scrollTop = 0;
      $$('.add-chat-sheet-content, .add-chat-subview', sheet).forEach(pane => { pane.scrollTop = 0; });
      sheet.style.removeProperty('height');
      sheet.style.removeProperty('max-height');
      sheet.style.removeProperty('transition');
      sheet.style.removeProperty('transform');
    }
    setAddChatView('main');
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    $('#attach-btn')?.classList.remove('is-active');
  }

  async function openAddChatProjectPicker() {
    const picker = $('#add-chat-project-picker');
    const content = $('#add-chat-project-picker-content');
    if (!picker || !content) return;
    setAddChatView('project');
    const chatIdAtOpen = state.currentChatId;
    picker.classList.remove('hidden');
    content.innerHTML = '<p>Загружаю проекты…</p>';
    try {
      const projects = await api.get('/api/projects');
      addChatProjects = Array.isArray(projects) ? projects.filter(item => item && item.id) : [];
      let activeChat = (state.chats || []).find(item => item && item.id === chatIdAtOpen) || null;
      if (chatIdAtOpen && !activeChat) {
        try { activeChat = await api.get('/api/chats/' + encodeURIComponent(chatIdAtOpen)); } catch (_) {}
      }
      const activeProjectId = chatIdAtOpen
        ? String(activeChat && activeChat.project_id || '')
        : String(pendingNewChatProjectId || '');
      content.innerHTML =
        '<p>' + (chatIdAtOpen
          ? 'Выберите проект для этого чата. При переносе AI CH попросит подтверждение.'
          : 'Проект будет назначен новому чату при создании или отправке первого сообщения.') + '</p>' +
        '<label for="add-chat-project-select">Проект</label>' +
        '<select id="add-chat-project-select"><option value="">Без проекта</option>' +
        addChatProjects.map(project =>
          '<option value="' + escapeHtml(String(project.id)) + '"' +
          (String(project.id) === activeProjectId ? ' selected' : '') + '>' +
          escapeHtml(project.title || 'Без названия') + '</option>'
        ).join('') + '</select>' +
        (!addChatProjects.length ? '<p class="add-chat-project-empty-note">Проектов пока нет. Сначала создайте проект или оставьте этот чат без проекта.</p>' : '') +
        '<div class="add-chat-project-picker-actions">' +
          '<button type="button" id="add-chat-project-cancel">Отмена</button>' +
          '<button type="button" class="primary" id="add-chat-project-save">Сохранить</button>' +
        '</div>' +
        '<button type="button" class="chip-btn add-chat-create-project" id="add-chat-create-project">' +
          '<svg class="ic"><use href="#i-plus"/></svg> Создать проект</button>';

      $('#add-chat-project-cancel')?.addEventListener('click', () => setAddChatView('main'));
      $('#add-chat-create-project')?.addEventListener('click', () => {
        closeAddToChatSheet();
        openProjectsWorkspace().then(() => {
          projectWorkspaceEditor = { id: '', title: '', description: '' };
          renderProjectsWorkspace();
          $('#workspace-project-name')?.focus();
        });
      });
      $('#add-chat-project-save')?.addEventListener('click', async event => {
        const save = event.currentTarget;
        const nextId = String($('#add-chat-project-select')?.value || '');
        if (!chatIdAtOpen) {
          pendingNewChatProjectId = nextId;
          pendingNewChatProjectLabel = (addChatProjects.find(item => String(item.id) === nextId) || {}).title || '';
          setAddChatView('main');
          renderAddChatActionLabels();
          toast(nextId ? 'Проект выбран для нового чата' : 'Новый чат будет без проекта');
          return;
        }
        const currentChat = (state.chats || []).find(item => item && item.id === chatIdAtOpen) || activeChat;
        const previousId = String(currentChat && currentChat.project_id || '');
        if (nextId === previousId) {
          setAddChatView('main');
          return;
        }
        const previousName = addChatProjects.find(item => String(item.id) === previousId)?.title || 'Без проекта';
        const nextName = addChatProjects.find(item => String(item.id) === nextId)?.title || 'Без проекта';
        if (!confirm('Изменить проект чата с «' + previousName + '» на «' + nextName + '»?')) return;
        save.disabled = true;
        try {
          const updated = await api.patch('/api/chats/' + encodeURIComponent(chatIdAtOpen), {
            project_id: nextId || null,
          });
          const index = state.chats.findIndex(item => item && item.id === updated.id);
          if (index >= 0) state.chats[index] = { ...state.chats[index], ...updated };
          else state.chats.push(updated);
          state.chatListVersion += 1;
          renderChatList();
          setAddChatView('main');
          renderAddChatActionLabels();
          toast(nextId ? 'Чат перемещён в проект «' + nextName + '»' : 'Чат убран из проекта');
        } catch (error) {
          save.disabled = false;
          toast('Не удалось изменить проект: ' + usefulErrorMessage(error, 'ошибка сохранения'), 'error');
        }
      });
    } catch (error) {
      content.innerHTML = '<p>Не удалось загрузить проекты: ' + escapeHtml(error.message || 'ошибка') + '</p>' +
        '<div class="add-chat-project-picker-actions"><button type="button" id="add-chat-project-cancel">Закрыть</button></div>';
      $('#add-chat-project-cancel')?.addEventListener('click', () => setAddChatView('main'));
    }
  }

  function bindAddToChatSheet() {
    const shell = $('#add-to-chat-shell');
    if (!shell || shell.dataset.bound === '1') return;
    shell.dataset.bound = '1';
    $$('[data-add-chat-close]', shell).forEach(button =>
      button.addEventListener('click', closeAddToChatSheet));
    $('#add-chat-nav')?.addEventListener('click', () => {
      if (addChatActiveView !== 'main') setAddChatView('main');
      else closeAddToChatSheet();
    });
    shell.addEventListener('click', event => {
      const button = event.target.closest('[data-add-chat-action]');
      if (!button) return;
      const action = button.dataset.addChatAction;
      if (action === 'files' || action === 'photos') {
        workspaceUploadIntent = false;
        const input = $('#file-input');
        if (!input) { toast('Выбор файлов недоступен в этом окне.', 'error'); return; }
        if (action === 'photos') input.setAttribute('accept', 'image/*');
        else input.removeAttribute('accept');
        // Keep the plus sheet open while the native picker is shown and after it returns.
        input.click();
      } else if (action === 'library') {
        openAddChatLibrary();
      } else if (action === 'model') {
        setAddChatView('model');
      } else if (action === 'response-detail') {
        setAddChatView('response-detail');
      } else if (action === 'deep-research') {
        state.deepResearch = !state.deepResearch;
        localStorage.setItem('aich_deep_research', state.deepResearch ? '1' : '0');
        renderAddChatActionLabels();
        toast(state.deepResearch ? 'Deep Research включён: до 5 агентов' : 'Deep Research выключен');
      } else if (action === 'memory') {
        setAddChatView('memory');
      } else if (action === 'project') {
        openAddChatProjectPicker();
      } else if (action === 'connectors') {
        setAddChatView('connectors');
      }
    });
    $('#add-chat-response-detail-options')?.addEventListener('click', event => {
      const button = event.target.closest('[data-response-detail]');
      if (!button) return;
      const value = button.dataset.responseDetail;
      if (!['minimum', 'standard', 'max'].includes(value)) return;
      state.responseDetail = value;
      localStorage.setItem('aich_response_detail', value);
      renderAddChatActionLabels();
      setAddChatView('main');
    });
    $('#add-chat-library-search')?.addEventListener('input', renderAddChatLibraryFiles);
    $('#add-chat-library-list')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-library-file-id]');
      if (!checkbox) return;
      const id = String(checkbox.dataset.libraryFileId || '');
      if (!id) return;
      if (checkbox.checked) addChatSelectedFileIds.add(id);
      else addChatSelectedFileIds.delete(id);
      const count = $('#add-chat-library-selected-count');
      if (count) count.textContent = String(addChatSelectedFileIds.size);
    });
    $('#add-chat-library-cancel')?.addEventListener('click', () => setAddChatView('main'));
    $('#add-chat-library-attach')?.addEventListener('click', attachSelectedLibraryFiles);

    const sheet = $('.add-to-chat-sheet', shell);
    let drag = null;
    if (sheet) {
      // Start on the whole sheet, not only the small handle. We intercept only
      // vertical gestures that should resize/close the sheet; normal content
      // scrolling remains available when an expanded pane is scrolled.
      sheet.addEventListener('pointerdown', event => {
        if (!shell.classList.contains('open') || !event.isPrimary ||
            (event.pointerType === 'mouse' && event.button !== 0)) return;
        drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dy: 0,
          expanded: sheet.classList.contains('is-expanded'),
          scrollArea: event.target.closest('.add-chat-sheet-content, .add-chat-subview')
        };
      });
      sheet.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy) * 1.15) return;
        if (!drag.tracking) {
          const atTop = !drag.scrollArea || drag.scrollArea.scrollTop <= 0;
          const resizeUp = dy < 0 && !drag.expanded;
          const resizeDown = dy > 0 && (drag.expanded ? atTop : true);
          if (!resizeUp && !resizeDown) {
            drag = null; // Let the scrollable pane handle this gesture naturally.
            return;
          }
          drag.tracking = true;
          try { sheet.setPointerCapture(event.pointerId); } catch (_) {}
        }
        drag.dy = dy;
        if (event.cancelable) event.preventDefault();
      });
      const finish = event => {
        if (!drag || drag.id !== event.pointerId) return;
        const current = drag;
        drag = null;
        if (!current.tracking) return;
        if (current.dy < -28 && !current.expanded) {
          sheet.classList.add('is-expanded');
        } else if (current.dy > 35 && current.expanded) {
          sheet.classList.remove('is-expanded');
        } else if (current.dy > 110 && !current.expanded) {
          closeAddToChatSheet();
        }
      };
      const cancel = event => {
        if (drag && drag.id === event.pointerId) drag = null;
      };
      sheet.addEventListener('pointerup', finish);
      sheet.addEventListener('pointercancel', cancel);
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && shell.classList.contains('open')) closeAddToChatSheet();
    });
    renderAddChatActionLabels();
  }

  let activeVoiceRecorder = null;
  let activeVoiceStream = null;
  let activeVoiceChunks = [];
  let activeVoiceRecognition = null;
  let activeVoiceTimer = null;
  let voicePaused = false;
  let voiceElapsedBeforePause = 0;
  let voiceSegmentStartedAt = 0;
  let voiceTranscript = '';
  let voiceUploadInProgress = false;

  function updateComposerActionButton() {
    const button = $('#send-btn');
    const input = $('#input');
    if (!button || !input) return;
    const emptyComposer = !input.value.trim();
    const useMic = emptyComposer && !activeVoiceRecorder && !voiceUploadInProgress &&
      !state.streaming && !state.sending && !state.chatLoading;
    const targetIcon = useMic ? 'mic' : 'arrow-up';
    button.innerHTML = '<svg class="ic"><use href="#i-' + targetIcon + '"/></svg>';
    button.title = useMic ? 'Записать голосовое сообщение' :
      (activeVoiceRecorder ? 'Отправить голосовое сообщение' : 'Отправить');
    button.setAttribute('aria-label', button.title);
  }

  function currentVoiceElapsedMs() {
    return voiceElapsedBeforePause +
      (voicePaused || !voiceSegmentStartedAt ? 0 : Math.max(0, Date.now() - voiceSegmentStartedAt));
  }

  function updateVoiceRecordingDisplay() {
    const time = $('#voice-recording-time');
    if (time) {
      const seconds = Math.floor(currentVoiceElapsedMs() / 1000);
      time.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
        String(seconds % 60).padStart(2, '0');
    }
    const waveform = $('#voice-waveform');
    if (waveform) waveform.classList.toggle('is-paused', voicePaused);
    const pauseButton = $('#voice-pause-btn');
    if (pauseButton) {
      pauseButton.innerHTML = '<svg class="ic"><use href="#i-' + (voicePaused ? 'play' : 'pause') + '"/></svg>';
      pauseButton.title = voicePaused ? 'Продолжить запись' : 'Пауза';
      pauseButton.setAttribute('aria-label', pauseButton.title);
    }
  }

  function showVoiceRecordingUi(show) {
    const row = $('.composer-row');
    const panel = $('#voice-recorder-ui');
    if (row) row.classList.toggle('is-recording', !!show);
    if (panel) panel.classList.toggle('hidden', !show);
    const attach = $('#attach-btn');
    if (attach) attach.disabled = !!show;
    updateComposerActionButton();
  }

  function startVoiceTranscriptionIfAvailable() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof Recognition !== 'function') return;
    try {
      const recognition = new Recognition();
      recognition.lang = 'ru-RU';
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = event => {
        for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const spoken = result && result.isFinal && result[0] ? String(result[0].transcript || '').trim() : '';
          if (spoken) voiceTranscript = (voiceTranscript + ' ' + spoken).trim();
        }
      };
      recognition.onerror = () => { /* Audio upload remains available if browser speech recognition is not supported. */ };
      recognition.onend = () => {
        if (activeVoiceRecorder && !voicePaused && activeVoiceRecognition === recognition) {
          try { recognition.start(); } catch (_) { /* recognition can stop between browser audio segments */ }
        }
      };
      activeVoiceRecognition = recognition;
      recognition.start();
    } catch (_) {
      activeVoiceRecognition = null;
    }
  }

  function stopVoiceTranscription() {
    const recognition = activeVoiceRecognition;
    activeVoiceRecognition = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch (_) { /* recognition may already be stopped */ }
    }
  }

  function resetVoiceRecordingUi() {
    if (activeVoiceTimer) clearInterval(activeVoiceTimer);
    activeVoiceTimer = null;
    stopVoiceTranscription();
    if (activeVoiceStream) activeVoiceStream.getTracks().forEach(track => {
      try { track.stop(); } catch (_) { /* device track already stopped */ }
    });
    activeVoiceStream = null;
    activeVoiceRecorder = null;
    activeVoiceChunks = [];
    voicePaused = false;
    voiceElapsedBeforePause = 0;
    voiceSegmentStartedAt = 0;
    showVoiceRecordingUi(false);
  }

  async function startVoiceRecording() {
    if (activeVoiceRecorder || voiceUploadInProgress || state.streaming || state.sending || state.chatLoading) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' ||
        typeof window.MediaRecorder !== 'function') {
      toast('Запись голосовых сообщений не поддерживается этим браузером.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      activeVoiceStream = stream;
      const mimeChoices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = typeof window.MediaRecorder.isTypeSupported === 'function'
        ? (mimeChoices.find(type => window.MediaRecorder.isTypeSupported(type)) || '')
        : '';
      const recorder = mimeType ? new window.MediaRecorder(stream, { mimeType }) : new window.MediaRecorder(stream);
      const chunks = [];
      activeVoiceRecorder = recorder;
      activeVoiceChunks = chunks;
      activeVoiceRecognition = null;
      voiceTranscript = '';
      voicePaused = false;
      voiceElapsedBeforePause = 0;
      voiceSegmentStartedAt = Date.now();
      recorder.addEventListener('dataavailable', event => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('error', () => {
        if (activeVoiceRecorder === recorder) {
          toast('Во время записи произошла ошибка.', 'error');
          cancelVoiceRecording();
        }
      });
      recorder.start(250);
      showVoiceRecordingUi(true);
      updateVoiceRecordingDisplay();
      if (activeVoiceTimer) clearInterval(activeVoiceTimer);
      activeVoiceTimer = setInterval(updateVoiceRecordingDisplay, 200);
      startVoiceTranscriptionIfAvailable();
    } catch (error) {
      resetVoiceRecordingUi();
      toast('Не удалось начать запись: ' + usefulErrorMessage(error, 'проверьте разрешение на микрофон'), 'error');
    }
  }

  function toggleVoiceRecordingPause() {
    const recorder = activeVoiceRecorder;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      if (recorder.state === 'recording') {
        recorder.pause();
        voiceElapsedBeforePause += Math.max(0, Date.now() - voiceSegmentStartedAt);
        voiceSegmentStartedAt = 0;
        voicePaused = true;
        if (activeVoiceRecognition) {
          try { activeVoiceRecognition.stop(); } catch (_) { /* recognition already stopped */ }
        }
      } else if (recorder.state === 'paused') {
        recorder.resume();
        voicePaused = false;
        voiceSegmentStartedAt = Date.now();
        if (activeVoiceRecognition) {
          try { activeVoiceRecognition.start(); } catch (_) { /* recognition may still be shutting down */ }
        }
      }
      updateVoiceRecordingDisplay();
    } catch (error) {
      toast('Не удалось изменить состояние записи: ' + usefulErrorMessage(error, 'ошибка записи'), 'error');
    }
  }

  function cancelVoiceRecording() {
    const recorder = activeVoiceRecorder;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (_) { /* recorder already stopped */ }
    }
    voiceTranscript = '';
    resetVoiceRecordingUi();
    const send = $('#send-btn');
    if (send) send.disabled = false;
  }

  async function finishVoiceRecordingAndSend() {
    const recorder = activeVoiceRecorder;
    if (!recorder || voiceUploadInProgress) return;
    voiceUploadInProgress = true;
    const chunks = activeVoiceChunks;
    const transcript = voiceTranscript.trim();
    const mimeType = recorder.mimeType || 'audio/webm';
    stopVoiceTranscription();
    try {
      let blob;
      if (recorder.state === 'inactive') {
        blob = new Blob(chunks, { type: mimeType });
      } else {
        const stopped = new Promise(resolve => {
          recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
        });
        recorder.stop();
        blob = await stopped;
      }
      resetVoiceRecordingUi();
      if (!blob || !blob.size) throw new Error('Запись пустая. Запишите голосовое сообщение ещё раз.');
      const mediaType = String(blob.type || mimeType).split(';')[0] || 'audio/webm';
      const extension = mediaType === 'audio/mp4' ? 'm4a' :
        (mediaType === 'audio/ogg' ? 'ogg' : (mediaType === 'audio/wav' ? 'wav' : 'webm'));
      const audioFile = new File([blob], 'voice-message-' + Date.now() + '.' + extension, { type: mediaType });
      const form = new FormData();
      form.append('files', audioFile, audioFile.name);
      const response = await api.postForm('/api/files', form);
      const uploaded = Array.isArray(response)
        ? response.find(file => file && typeof file.id === 'string' && file.id)
        : null;
      if (!uploaded) throw new Error('Сервер не подтвердил сохранение голосового сообщения.');
      const fileMap = new Map((Array.isArray(state.files) ? state.files : []).filter(file => file && file.id)
        .map(file => [String(file.id), file]));
      fileMap.set(String(uploaded.id), uploaded);
      state.files = Array.from(fileMap.values());
      const pendingMap = new Map((Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [])
        .filter(file => file && file.id).map(file => [String(file.id), file]));
      pendingMap.set(String(uploaded.id), uploaded);
      state.pendingAttachments = Array.from(pendingMap.values());
      renderFiles();
      renderFilesWorkspace();
      renderAttachments();
      const input = $('#input');
      if (input) {
        input.value = transcript || 'Прослушай прикреплённое голосовое сообщение и ответь на него.';
        autoGrow();
      }
      voiceUploadInProgress = false;
      const send = $('#send-btn');
      if (send) send.disabled = false;
      updateComposerActionButton();
      if (input) input.focus();
      await sendCurrent();
    } catch (error) {
      voiceUploadInProgress = false;
      const send = $('#send-btn');
      if (send) send.disabled = false;
      updateComposerActionButton();
      if (activeVoiceRecorder) cancelVoiceRecording();
      toast('Не удалось отправить голосовое сообщение: ' + usefulErrorMessage(error, 'ошибка загрузки'), 'error');
    }
  }

  function openComposerEmojiPicker() {
    const input = $('#input');
    if (!input) return;
    const selectionStart = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const selectionEnd = Number.isInteger(input.selectionEnd) ? input.selectionEnd : selectionStart;
    const emojis = [
      '😀','😃','😄','😁','😆','😅','😂','🤣',
      '🙂','🙃','😉','😊','😇','🥰','😍','😘',
      '😋','😎','🤔','🫡','🤗','🤩','🥳','😴',
      '😭','😢','😡','🤯','😱','😬','😌','🫠',
      '👍','👎','👏','🙌','🙏','🤝','💪','🫶',
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍',
      '🔥','✨','⭐','💯','✅','❌','🎉','🚀',
      '📌','💡','📎','🎯','🌍','☀️','🌧️','🐱'
    ];
    openModal({
      title: 'Эмодзи',
      okText: 'Закрыть',
      extraClass: 'bottom-sheet composer-emoji-sheet',
      body: '<div class="composer-emoji-grid" role="group" aria-label="Выберите эмодзи">' +
        emojis.map(emoji => '<button type="button" data-composer-emoji="' + emoji + '" aria-label="' + emoji + '">' + emoji + '</button>').join('') +
        '</div>',
      onOk: () => true,
    });
    const root = $('#modal-root');
    $$('.composer-emoji-grid [data-composer-emoji]', root).forEach(button => {
      button.addEventListener('click', () => {
        const emoji = button.dataset.composerEmoji || '';
        const value = input.value;
        input.value = value.slice(0, selectionStart) + emoji + value.slice(selectionEnd);
        const caret = selectionStart + emoji.length;
        input.focus();
        input.setSelectionRange(caret, caret);
        autoGrow();
        updateComposerActionButton();
        closeModal();
      });
    });
  }

  function bindComposer() {
    const input = $('#input');
    updateComposerActionButton();
    bindAddToChatSheet();
    const modelButton = $('#model-select-btn'), modelPanel = $('#model-picker');
    if (modelButton) modelButton.addEventListener('click', event => { event.stopPropagation(); setAddChatView(state.modelPickerOpen ? 'main' : 'model'); });
    if (modelPanel) modelPanel.addEventListener('click', async event => {
      const option = event.target.closest('[data-model-index]'); if (!option) return;
      const modelIndex = Number(option.dataset.modelIndex);
      const cluster = Number.isInteger(modelIndex) && modelIndex >= 0 ? state.modelSets[modelIndex] : null; if (!cluster) return;
      if (!modelSetCanUse(cluster)) { toast('Эта модель доступна только по подписке Pro.', 'error'); return; }
      try {
        if (state.currentChatId) await api.patch('/api/chats/' + encodeURIComponent(state.currentChatId), {model_set_id: cluster.id});
        state.modelSetId = cluster.id; localStorage.setItem('aich_model_set_id', cluster.id);
        const current = state.chats.find(c => c && c.id === state.currentChatId);
        if (current) { current.model_set_id = cluster.id; current.model_name = cluster.name; }
        setAddChatView('main'); renderAddChatActionLabels(); renderChatList();
      } catch (error) { toast('Не удалось выбрать модель: ' + usefulErrorMessage(error, 'ошибка сохранения'), 'error'); }
    });
    input.addEventListener('input', () => { autoGrow(); updateComposerActionButton(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    });
    $('#send-btn').addEventListener('click', async () => {
      if (voiceUploadInProgress) return;
      if (activeVoiceRecorder) await finishVoiceRecordingAndSend();
      else if (!input.value.trim()) await startVoiceRecording();
      else await sendCurrent();
    });
    $('#voice-cancel-btn')?.addEventListener('click', cancelVoiceRecording);
    $('#voice-pause-btn')?.addEventListener('click', toggleVoiceRecordingPause);
    $('#stop-btn').addEventListener('click', async () => {
      if (state.activeAssistantId) await api.post('/api/messages/' + state.activeAssistantId + '/stop');
    });
    $('#attach-btn').addEventListener('click', () => {
      workspaceUploadIntent = false;
      const shell = $('#add-to-chat-shell');
      if (shell && shell.classList.contains('open')) closeAddToChatSheet(); else openAddToChatSheet();
    });
    $('#file-input').addEventListener('cancel', () => { workspaceUploadIntent = false; });
    $('#file-input').addEventListener('cancel', () => { $('#file-input').removeAttribute('accept'); });
    $('#file-input').addEventListener('change', async (e) => {
      $('#file-input').removeAttribute('accept');
      const files = Array.from(e.target.files || []);
      const options = { libraryOnly: workspaceUploadIntent };
      workspaceUploadIntent = false;
      if (files.length) await uploadFiles(files, options);
      e.target.value = '';
    });
    if ($('#context-btn')) $('#context-btn').addEventListener('click', openUsageModal);
    if ($('#project-btn')) $('#project-btn').addEventListener('click', () => toggleProjectPanel());
    if ($('#pp-close')) $('#pp-close').addEventListener('click', () => toggleProjectPanel(false));
    if ($('#pp-refresh')) $('#pp-refresh').addEventListener('click', () => loadProject(true));
    if ($('#pp-git')) $('#pp-git').addEventListener('click', openGit);
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // percent of the plan's dollar budget spent inside the rolling window
  function windowUsage() {
    const w = (state.limits && state.limits.window) || null;
    if (!w || w.budget_usd === null || w.budget_usd === undefined) return null;
    return w;
  }

  function planUsage() {
    const data = state.limits || {};
    const lim = data.limits || {};
    const use = data.usage || {};
    const defs = [
      ['files', 'files_count', 'Файлы', 'шт'],
      ['storage', 'user_storage', 'Хранилище', ' Б'],
    ];
    const rows = [];
    defs.forEach(d => {
      const used = Number(use[d[0]] || 0);
      const cap = lim[d[1]];
      const unlimited = (cap === null || cap === undefined);
      const pct = unlimited ? 0 : Math.min(100, Math.round(used / cap * 100));
      rows.push({ key: d[0], label: d[2], unit: d[3], used: used, cap: cap, unlimited: unlimited, pct: pct });
    });
    const worst = rows.reduce((m, r) => (r.unlimited ? m : Math.max(m, r.pct)), 0);
    return { rows: rows, worst: worst, plan: data.plan || 'free' };
  }

  function paintUsage(pct, note) {
    const btn = $('#context-btn');
    if (!btn) return;
    const ring = $('#usage-bar');
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    if (ring) {
      if (ring.tagName && ring.tagName.toLowerCase() === 'circle') {
        ring.style.strokeDasharray = '100';
        ring.style.strokeDashoffset = String(100 - p);
      } else {
        ring.style.width = p + '%';
      }
    }
    btn.classList.toggle('warn', p >= 80);
    btn.classList.toggle('full', p >= 100);
    btn.title = note;
    btn.setAttribute('aria-label', 'Лимиты использования. Нажмите, чтобы открыть подробности.');
  }

  async function loadUsage() {
    if (!$('#context-btn')) return;
    if (!state.limits) await loadLimits();
    const w = windowUsage();
    if (w) {
      paintUsage(w.percent,
        'Израсходовано $' + Number(w.spend_usd).toFixed(2) + ' из $' + w.budget_usd +
        ' за ' + w.hours + ' ч · осталось $' +
        Math.max(0, w.budget_usd - w.spend_usd).toFixed(2));
      return;
    }
    const info = planUsage();
    paintUsage(info.worst, 'Использование лимитов подписки');
  }

  function usageCards(u) {
    const card = (label, val) =>
      '<div class="usage-card"><span>' + label + '</span><b>' + val + '</b></div>';
    return '<div class="usage-grid">' +
      card('Вход', fmtNum(u.tokens_in)) +
      card('Выход', fmtNum(u.tokens_out)) +
      card('Из кэша', fmtNum(u.tokens_cached)) +
      card('Сообщений', u.messages) +
      card('Средний вход', fmtNum(u.avg_in)) +
      card('Занято', (u.percent || 0).toFixed(2) + '%') +
      '</div>';
  }

  function limitsHtml(plan) {
    const data = state.limits || {};
    const currentPlan = String(data.plan || plan || 'free').toLowerCase();
    if (!data.limits || !data.compare || !data.compare.free || !data.compare.pro) {
      return '<h4 class="sec">Лимиты тарифов</h4>' +
        '<p class="usage-note">Не удалось загрузить актуальное сравнение тарифов. Закройте окно и попробуйте ещё раз.</p>';
    }
    return '<h4 class="sec">Лимиты тарифов Free и Pro</h4>' +
      '<p class="usage-note">Показаны действующие настройки с сервера. Оплата Pro пока оформляется через администратора.</p>' +
      planCompareHtml(data.limits, data.compare) +
      '<p class="usage-note">Ваш текущий тариф: ' + escapeHtml(currentPlan.toUpperCase()) + '.</p>';
  }

  async function loadLimits() {
    try {
      state.limits = await api.getTimed('/api/limits', 8000);
      return null;
    } catch (e) {
      // Keep previously loaded limits available if a refresh fails.
      return e;
    } finally {
      updateAllAudioControls();
    }
  }

  async function openContextMenu() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    let u;
    try { u = await api.get('/api/chats/' + state.currentChatId + '/usage'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    state.usage = u;
    const barW = Math.min(100, Math.max(0, u.percent || 0));
    const lim = (state.limits && state.limits.limits) || {};
    const cmin = Number(lim.compress_min != null ? lim.compress_min : 5);
    const cmax = Number(lim.compress_max != null ? lim.compress_max : 85);
    const cdef = Math.max(cmin, Math.min(cmax, Math.round((cmin + cmax) / 2 / 5) * 5));
    const perDay = lim.compress_per_day;
    openModal({
      title: 'Контекст и проценты',
      okText: 'Закрыть',
      body: '<h4 class="sec">Контекст и проценты</h4>' +
        usageCards(u) +
        '<div class="usage-bar"><i style="width:' + barW + '%"></i></div>' +
        '<p class="usage-note">Окно модели — ' + fmtNum(u.context_len) + ' токенов. ' +
        'Резюме истории: ' + (u.summary_chars ? fmtNum(u.summary_chars) + ' симв.' : 'нет') + '. ' +
        'Усилие: ' + escapeHtml(u.effort || 'recommended') + '.</p>' +
        '<label style="margin-top:14px">Сжать историю до <b id="cmp-val">' + cdef + '</b>%</label>' +
        '<input type="range" id="cmp-range" class="orange-range" min="' + cmin + '" max="' + cmax +
        '" step="5" value="' + cdef + '" />' +
        '<p class="usage-note">Ваш тариф («' + escapeHtml((state.limits && state.limits.plan) || 'free') +
        '»): сжатие от ' + cmin + '% до ' + cmax + '%' +
        (perDay != null ? ' · до ' + perDay + ' сжатий в день' : ' · без лимита сжатий') + '.</p>' +
        '<p class="usage-note">Сжатие делает та же модель: старое сворачивается в краткое резюме.</p>' +
        '<div style="margin-top:10px"><button class="chip-btn" id="cmp-go">' +
        icon('sparkle') + 'Сжать историю</button></div>' +
        limitsHtml(state.user && state.user.plan),
      onOk: () => true,
    });
    const r = $('#cmp-range');
    if (r) r.addEventListener('input', () => { $('#cmp-val').textContent = r.value; });
    const go = $('#cmp-go');
    if (go) go.addEventListener('click', async () => {
      const p = parseInt(r.value, 10) || 50;
      toast('Сжимаю историю…');
      try {
        await api.post('/api/chats/' + state.currentChatId + '/compress', { target_percent: p });
        toast('История сжата');
        $('#modal-root').innerHTML = '';
        await loadUsage();
      } catch (e) { toast('Не удалось: ' + e.message, 'error'); }
    });
  }

  async function openLinks() {
    let items = [];
    try { items = await api.get('/api/chats/shared'); } catch (e) { items = []; }
    openModal({
      title: 'Мои публичные ссылки',
      okText: 'Закрыть',
      body: items.length
        ? '<div class="link-list">' + items.map(s =>
            '<div class="link-row"><div class="link-info"><b>' + escapeHtml(s.title) + '</b>' +
            '<span>' + s.messages + ' сообщ. · ' + timeAgo(s.created_at) + '</span></div>' +
            '<button class="chip-btn" data-copy-link="' + s.share_token + '" title="Копировать">' + icon('copy') + '</button>' +
            '<button class="chip-btn" data-open-link="' + s.share_token + '" title="Открыть">' + icon('link') + '</button>' +
            '</div>').join('') + '</div>'
        : '<p>Пока нет публичных ссылок. Откройте чат и нажмите иконку «Поделиться».</p>',
      onOk: () => true,
    });
    $$('[data-copy-link]').forEach(b => b.addEventListener('click', async () => {
      const ok = await copyText(location.origin + '/?share=' + b.dataset.copyLink);
      toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать', ok ? '' : 'error');
    }));
    $$('[data-open-link]').forEach(b => b.addEventListener('click', () =>
      window.open('/?share=' + b.dataset.openLink, '_blank')));
  }

  async function openReadyAnswersAdmin() {
    const root = $('#modal-root');
    let currentQuery = '';
    let currentSeedOffset = 0;
    const seedPageSize = 100;
    let searchTimer = null;
    const labels = {queued:'В очереди', generating:'Генерируется', completed:'Готово', failed:'Ошибка'};
    const esc = value => escapeHtml(String(value == null ? '' : value));

    async function rerender(q = currentQuery) {
      const oldSearch = $('#ready-search', root);
      const keepSearchFocus = !!oldSearch && document.activeElement === oldSearch;
      const searchStart = keepSearchFocus ? oldSearch.selectionStart : null;
      const searchEnd = keepSearchFocus ? oldSearch.selectionEnd : null;
      currentQuery = q;
      let d;
      try {
        d = await api.get('/api/admin/ready-answers?q=' + encodeURIComponent(q) +
          '&limit=' + (q ? 10 : 1) + '&seed_limit=' + seedPageSize + '&seed_offset=' + currentSeedOffset);
      }
      catch (e) { toast('Не удалось открыть базу готовых ответов: ' + e.message, 'error'); return; }
      const s = d.stats || {}, cfg = d.settings || {};
      const seedTotal = Number(d.seed_total || 0);
      const seedOffset = Number(d.seed_offset || 0);
      const seedLimit = Number(d.seed_limit || seedPageSize);
      const answers = (d.results || []).map(a =>
        '<details class="aux-model-card" style="margin:10px 0"><summary style="cursor:pointer;font-weight:600">' +
        esc(a.source_query || 'Готовый ответ') + ' · ' + (a.titles || []).length + ' заголовков</summary>' +
        '<p class="usage-note">Создан: ' + esc(a.created_at || '—') + '</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px;margin:10px 0">' + (a.titles || []).map(t =>
          '<span style="border:1px solid var(--border,#ddd);border-radius:12px;padding:3px 8px;font-size:12px">' + esc(t) + '</span>'
        ).join('') + '</div><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:280px;overflow:auto;padding:12px;background:var(--surface,#f7f7f7);border-radius:10px">' +
        esc(a.answer) + '</pre><footer><button type="button" data-ready-delete-answer="' + esc(a.id) + '">Удалить ответ</button></footer></details>'
      ).join('') || '<p class="usage-note">Ничего не найдено. Поиск идёт по всем заголовкам, а не по тексту ответа.</p>';
      const tasks = (d.tasks || []).map(t => {
        const controls = t.status === 'failed'
          ? '<button type="button" data-ready-retry="' + esc(t.id) + '">Повторить</button><button type="button" data-ready-delete-task="' + esc(t.id) + '">Убрать</button>'
          : (t.status !== 'generating' ? '<button type="button" data-ready-delete-task="' + esc(t.id) + '">Убрать</button>' : '');
        return '<div class="kv" style="align-items:flex-start;gap:10px;border-bottom:1px solid var(--border,#ddd);padding:10px 0"><div style="flex:1;min-width:0"><b>' +
          esc(labels[t.status] || t.status) + '</b> · ' + (t.source === 'prepared' ? 'подготовленный вопрос' : 'ручной запрос') +
          '<div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(t.query) + '</div>' +
          (t.error ? '<p class="usage-note" style="color:var(--danger,#b33)">' + esc(t.error) + '</p>' : '') +
          '</div><div style="display:flex;gap:5px;flex-wrap:wrap">' + controls + '</div></div>';
      }).join('') || '<p class="usage-note">Очередь пока пустая.</p>';
      const seeds = (d.seed_questions || []).map(x => '<div class="kv"><span>' + esc(x.position) + '. ' + esc(x.question) +
        '</span><b>' + (x.consumed ? 'уже взят' : 'ожидает авто') + '</b></div>').join('');
      const seedRange = (seedTotal ? seedOffset + 1 : 0) + '–' +
        Math.min(seedOffset + seedLimit, seedTotal) + ' из ' + seedTotal;
      root.innerHTML = '<div class="modal-back ready-answers-back"><div class="modal ready-answers-modal"><h3>База готовых ответов</h3>' +
        '<div class="modal-body ready-answers-body"><div class="usage-grid">' +
        '<div class="usage-card"><span>Ответы</span><b>' + Number(s.answers || 0).toLocaleString('ru-RU') + '</b></div>' +
        '<div class="usage-card"><span>Заголовки</span><b>' + Number(s.titles || 0).toLocaleString('ru-RU') + '</b></div>' +
        '<div class="usage-card"><span>В очереди</span><b>' + Number(s.queued || 0).toLocaleString('ru-RU') + '</b></div>' +
        '<div class="usage-card"><span>Генерируется</span><b>' + Number(s.generating || 0).toLocaleString('ru-RU') + '</b></div></div>' +
        '<section class="aux-model-card" style="margin:12px 0"><header><div><b>Фоновая генерация</b><p>Одиночный запрос можно поставить следующим в очередь. Пачки попадают в подготовленный список и не запускаются сразу; автогенерация забирает их из этого списка, когда включена.</p></div></header>' +
        '<div class="aux-model-fields"><label><span>Параллельных запросов (1–20)</span><input id="ready-parallel" type="number" min="1" max="20" value="' + esc(cfg.parallelism || 2) + '"></label>' +
        '<label><span>Заголовков на ответ (10–500)</span><input id="ready-title-count" type="number" min="10" max="500" value="' + esc(cfg.titles_per_answer || 30) + '"></label></div>' +
        '<footer style="justify-content:space-between;flex-wrap:wrap;gap:10px"><label><input id="ready-use-cache" type="checkbox"' + (cfg.lookup_enabled !== false ? ' checked' : '') +
        '> Использовать готовые ответы при совпадении запроса</label><label><input id="ready-auto" type="checkbox"' + (cfg.auto_enabled ? ' checked' : '') +
        '> Автогенерация по подготовленным вопросам</label><button type="button" id="ready-save-settings">Сохранить параметры</button></footer></section>' +
        '<h4 class="sec">Добавить один запрос следующим</h4><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="ready-next-query" style="flex:1;min-width:220px" maxlength="2000" placeholder="Запрос, который пойдёт следующим">' +
        '<button type="button" id="ready-add-next">В очередь следующим</button></div>' +
        '<label style="display:block;margin-top:14px"><span>Пачка для подготовленного списка — один вопрос на строку, до 500 запросов</span><textarea id="ready-batch" rows="5" maxlength="1000000" placeholder="Объясни рекурсию в Python&#10;Как решать квадратные уравнения?&#10;Что такое производная?"></textarea></label>' +
        '<div style="display:flex;justify-content:flex-end;margin:8px 0 18px"><button type="button" id="ready-add-batch">Добавить пачку в подготовленные</button></div>' +
        '<h4 class="sec">Поиск по всем заголовкам</h4><div style="display:flex;gap:8px"><input id="ready-search" style="flex:1;min-width:0" type="search" value="' + esc(currentQuery) +
        '" placeholder="Часть или полный заголовок"><button type="button" id="ready-refresh">Обновить</button></div><div id="ready-results">' + answers + '</div>' +
        '<h4 class="sec">Запросы и очередь</h4><p class="usage-note">Активные запросы показываются из очереди; в истории — только последние 3 завершённых или ошибочных запроса.</p><div id="ready-tasks">' + tasks + '</div>' +
        '<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Подготовленный список (' + seedTotal +
        ' вопросов; ожидают авто: ' + Number(s.prepared_remaining || 0) + ')</summary>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0">' +
        '<span class="usage-note">Показаны ' + seedRange + '</span><div style="display:flex;gap:8px">' +
        '<button type="button" id="ready-seed-prev"' + (seedOffset <= 0 ? ' disabled' : '') + '>Назад</button>' +
        '<button type="button" id="ready-seed-next"' + (seedOffset + seedLimit >= seedTotal ? ' disabled' : '') + '>Далее</button>' +
        '</div></div><div style="margin-top:8px">' + seeds + '</div></details></div>' +
        '<div class="row"><span style="flex:1"></span><button class="solid" data-ready-close>Закрыть</button></div></div></div>';

      if (keepSearchFocus) {
        const searchAfterRender = $('#ready-search', root);
        if (searchAfterRender) {
          searchAfterRender.focus();
          if (searchStart != null && searchEnd != null) {
            try { searchAfterRender.setSelectionRange(searchStart, searchEnd); } catch (_) { /* search input support varies */ }
          }
        }
      }
      $('[data-ready-close]', root).addEventListener('click', () => { root.innerHTML = ''; });
      $('#ready-seed-prev', root).addEventListener('click', async () => {
        currentSeedOffset = Math.max(0, seedOffset - seedLimit);
        await rerender(currentQuery);
      });
      $('#ready-seed-next', root).addEventListener('click', async () => {
        if (seedOffset + seedLimit < seedTotal) {
          currentSeedOffset = seedOffset + seedLimit;
          await rerender(currentQuery);
        }
      });
      $('#ready-refresh', root).addEventListener('click', () => rerender($('#ready-search', root).value.trim()));
      $('#ready-search', root).addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => rerender($('#ready-search', root).value.trim()), 350);
      });
      $('#ready-save-settings', root).addEventListener('click', async () => {
        const parallelism = Number($('#ready-parallel', root).value);
        const titles_per_answer = Number($('#ready-title-count', root).value);
        if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 20 ||
            !Number.isInteger(titles_per_answer) || titles_per_answer < 10 || titles_per_answer > 500) {
          toast('Параллельность: 1–20; количество заголовков: 10–500.', 'error'); return;
        }
        try {
          await api.patch('/api/admin/ready-answers/settings', {lookup_enabled:$('#ready-use-cache', root).checked, auto_enabled:$('#ready-auto', root).checked, parallelism, titles_per_answer});
          toast('Параметры сохранены'); await rerender(currentQuery);
        } catch (e) { toast('Не удалось сохранить: ' + e.message, 'error'); }
      });
      $('#ready-add-next', root).addEventListener('click', async () => {
        const query = $('#ready-next-query', root).value.trim();
        if (!query) { toast('Введите запрос.', 'error'); return; }
        try {
          const result = await api.post('/api/admin/ready-answers/queue', {queries:[query], priority_first:true});
          $('#ready-next-query', root).value = '';
          toast('Добавлено в очередь: ' + Number(result.added || 0)); await rerender(currentQuery);
        } catch (e) { toast('Не удалось добавить запрос: ' + e.message, 'error'); }
      });
      $('#ready-add-batch', root).addEventListener('click', async () => {
        const queries = $('#ready-batch', root).value.split(/\r?\n/)
          .map(line => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
        if (!queries.length) { toast('Вставьте запросы: один на строку.', 'error'); return; }
        if (queries.length > 500) { toast('За раз можно добавить не более 500 запросов.', 'error'); return; }
        try {
          const result = await api.post('/api/admin/ready-answers/prepared-questions', {queries});
          $('#ready-batch', root).value = '';
          currentSeedOffset = 0;
          toast('Добавлено в подготовленные: ' + Number(result.added || 0) + '; пропущено: ' + Number(result.skipped || 0));
          await rerender(currentQuery);
        } catch (e) { toast('Не удалось добавить пачку: ' + e.message, 'error'); }
      });
      $$('[data-ready-retry]', root).forEach(b => b.addEventListener('click', async () => {
        try { await api.post('/api/admin/ready-answers/tasks/' + b.dataset.readyRetry + '/retry', {}); await rerender(currentQuery); }
        catch (e) { toast('Не удалось повторить: ' + e.message, 'error'); }
      }));
      $$('[data-ready-delete-task]', root).forEach(b => b.addEventListener('click', async () => {
        try { await api.del('/api/admin/ready-answers/tasks/' + b.dataset.readyDeleteTask); await rerender(currentQuery); }
        catch (e) { toast('Не удалось удалить задачу: ' + e.message, 'error'); }
      }));
      $$('[data-ready-delete-answer]', root).forEach(b => b.addEventListener('click', async () => {
        if (b.disabled || b.dataset.deleting === '1') return;
        const answerId = b.dataset.readyDeleteAnswer;
        const oldLabel = b.textContent;
        b.disabled = true;
        b.dataset.deleting = '1';
        b.textContent = 'Удаление…';
        b.setAttribute('aria-busy', 'true');
        try {
          const result = await api.delTimed('/api/admin/ready-answers/answers/' + encodeURIComponent(answerId), 20000);
          if (!result || result.ok !== true || result.deleted !== true) {
            throw new Error('Сервер не подтвердил удаление записи.');
          }
          toast('Ответ удалён');
          await rerender(currentQuery);
        } catch (e) {
          b.disabled = false;
          b.dataset.deleting = '0';
          b.textContent = oldLabel;
          b.removeAttribute('aria-busy');
          toast('Удаление не подтверждено: ' + e.message, 'error');
        }
      }));
    }
    await rerender('');
  }

  async function openAdminStats() {
    let s;
    try { s = await api.get('/api/admin/stats'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    const maxH = Math.max(1, ...s.hourly.map(h => h.messages));
    const bars = s.hourly.length
      ? s.hourly.map(h =>
          '<div class="bar" title="' + escapeHtml(h.hour) + ' — ' + h.messages + ' сообщ.">' +
          '<i style="height:' + Math.round((h.messages / maxH) * 100) + '%"></i>' +
          '<span>' + escapeHtml((h.hour || '').slice(11, 13)) + '</span></div>').join('')
      : '<p class="usage-note">Нет данных за 24 часа</p>';
    const card = (label, val) =>
      '<div class="usage-card"><span>' + label + '</span><b>' + val + '</b></div>';
    openModal({
      title: 'Статистика использования',
      okText: 'Закрыть',
      body: '<div class="usage-grid">' +
        card('Пользователи', s.users) + card('Чаты', s.chats) +
        card('Сообщения', s.messages) + card('Файлы', s.files) +
        card('Токенов вход', fmtNum(s.tokens_in)) + card('Токенов выход', fmtNum(s.tokens_out)) +
        card('Из кэша', fmtNum(s.tokens_cached)) +
        card('Оценки', '👍 ' + s.rating_up + ' · 👎 ' + s.rating_down) +
        '</div>' +
        '<h4 class="sec">Активность за 24 часа</h4><div class="chart">' + bars + '</div>' +
        '<h4 class="sec">Модели</h4>' +
        (s.top_models.length
          ? s.top_models.map(m => '<div class="kv"><span>' + escapeHtml(m.name) + '</span><b>' + m.count + '</b></div>').join('')
          : '<p class="usage-note">—</p>'),
      onOk: () => true,
    });
  }

  async function openAdminChats() {
    openModal({
      title: 'Все чаты · поиск и сортировка', okText: 'Закрыть',
      extraClass: 'wide admin-chats-modal',
      body: '<div class="admin-chat-filters">' +
        '<label class="admin-chat-q"><span>Поиск по всем данным</span><input id="admin-chat-q" type="search" placeholder="Тема, ID, пользователь, email, текст сообщений, модель"></label>' +
        '<label><span>Владелец</span><input id="admin-chat-owner" type="search" placeholder="Имя или email"></label>' +
        '<label><span>Модель / кластер</span><input id="admin-chat-model" type="search" placeholder="Название модели"></label>' +
        '<label><span>Сортировать по</span><select id="admin-chat-sort"><option value="updated_at">Последнее обновление</option><option value="created_at">Дата создания</option><option value="title">Название</option><option value="owner">Владелец</option><option value="messages">Сообщения</option><option value="tokens_in">Токены входа</option><option value="tokens_out">Токены выхода</option><option value="tokens_cached">Кэш-токены</option><option value="rating_up">👍 оценки</option><option value="rating_down">👎 оценки</option></select></label>' +
        '<label><span>Направление</span><select id="admin-chat-order"><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label>' +
        '<label><span>Видимость</span><select id="admin-chat-public"><option value="any">Все</option><option value="true">Публичные</option><option value="false">Приватные</option></select></label>' +
        '<label><span>Оценки</span><select id="admin-chat-rating"><option value="any">Любые</option><option value="up">Есть 👍</option><option value="down">Есть 👎</option></select></label>' +
        '<label><span>Создан от</span><input id="admin-chat-created-from" type="datetime-local"></label><label><span>Создан до</span><input id="admin-chat-created-to" type="datetime-local"></label>' +
        '<label><span>Обновлён от</span><input id="admin-chat-updated-from" type="datetime-local"></label><label><span>Обновлён до</span><input id="admin-chat-updated-to" type="datetime-local"></label>' +
        '<label><span>Сообщений от</span><input id="admin-chat-min-messages" type="number" min="0" placeholder="0"></label><label><span>Сообщений до</span><input id="admin-chat-max-messages" type="number" min="0" placeholder="без лимита"></label>' +
        '<label><span>Токенов от</span><input id="admin-chat-min-tokens" type="number" min="0" placeholder="0"></label><label><span>Токенов до</span><input id="admin-chat-max-tokens" type="number" min="0" placeholder="без лимита"></label>' +
        '</div><div id="admin-chat-results-info" class="usage-note">Загрузка…</div><div id="admin-chat-results" class="link-list admin-chat-results"><p>Загрузка…</p></div>',
      onOk: () => true
    });
    const root=$('#modal-root');
    const fields={q:'admin-chat-q',owner_q:'admin-chat-owner',model_q:'admin-chat-model',sort_by:'admin-chat-sort',order:'admin-chat-order',
      is_public:'admin-chat-public',rating:'admin-chat-rating',created_from:'admin-chat-created-from',created_to:'admin-chat-created-to',
      updated_from:'admin-chat-updated-from',updated_to:'admin-chat-updated-to',min_messages:'admin-chat-min-messages',
      max_messages:'admin-chat-max-messages',min_tokens:'admin-chat-min-tokens',max_tokens:'admin-chat-max-tokens'};
    let timer=null, generation=0;
    function buildParams(){
      const params=new URLSearchParams({limit:'10000',sort_by:$('#admin-chat-sort',root).value,order:$('#admin-chat-order',root).value});
      for(const [key,id] of Object.entries(fields)){
        const el=$('#'+id,root); if(!el||!String(el.value||'').trim()||(key==='is_public'&&el.value==='any')||(key==='rating'&&el.value==='any'))continue;
        let value=el.value;
        if(key.endsWith('_from')||key.endsWith('_to')){const d=new Date(value);if(!Number.isNaN(d.getTime()))value=d.toISOString();}
        params.set(key,value);
      }
      return params;
    }
    async function load(){
      const request=++generation, list=$('#admin-chat-results',root), info=$('#admin-chat-results-info',root);
      if(!list||!info)return; info.textContent='Ищем по серверной базе чатов…';
      try{
        const items=await api.get('/api/admin/chats?'+buildParams().toString());
        if(request!==generation||!$('#admin-chat-results',root))return;
        info.textContent='Найдено: '+items.length+(items.length>=10000?' · предел выдачи 10 000, уточните фильтры':'')+' · поиск по содержимому сообщений, владельцам, email, моделям и датам';
        list.innerHTML=items.length?items.map(c=>
          '<div class="link-row admin-chat-row"><div class="link-info"><b>'+escapeHtml(c.title)+'</b><span>'+escapeHtml(c.owner)+' · '+escapeHtml(String(c.updated_at||'').replace('T',' ').slice(0,16))+
          ' · '+c.messages+' сообщ. · вход '+fmtNum(c.tokens_in)+' · выход '+fmtNum(c.tokens_out)+' · кэш '+fmtNum(c.tokens_cached||0)+' · 👍'+c.rating_up+' 👎'+c.rating_down+' · '+(c.is_public?'публичный':'приватный')+
          '</span><small>ID: '+escapeHtml(c.id)+' · создан: '+escapeHtml(String(c.created_at||'').replace('T',' ').slice(0,16))+'</small></div><button class="chip-btn" data-open-chat="'+escapeHtml(c.id)+'">'+icon('link')+'Открыть</button></div>'
        ).join(''):'<p>По этим критериям чаты не найдены.</p>';
      }catch(e){if(request!==generation)return;info.textContent='Не удалось загрузить чаты: '+e.message;list.innerHTML='<p class="usage-note">Измените фильтры или повторите поиск.</p>';}
    }
    for(const [key,id] of Object.entries(fields)){
      const el=$('#'+id,root);if(!el)continue;
      const live=['q','owner_q','model_q'].includes(key);
      el.addEventListener(live?'input':'change',()=>{if(live){clearTimeout(timer);timer=setTimeout(load,280);}else load();});
    }
    root.addEventListener('click',async e=>{
      const b=e.target.closest('[data-open-chat]');if(!b||!root.contains(b))return;
      try{const share=await api.post('/api/admin/chats/'+encodeURIComponent(b.dataset.openChat)+'/share');window.open('/?share='+encodeURIComponent(share.share_token),'_blank');}
      catch(err){toast('Ошибка: '+err.message,'error');}
    });
    await load();
  }

  function openDedicatedWorkspace(shell) {
    $$('.files-workspace-shell.open').forEach(other => {
      if (other === shell) return;
      other.classList.remove('open');
      other.classList.add('hidden');
      other.setAttribute('aria-hidden','true');
    });
    document.body.classList.remove('files-workspace-open');
    shell.classList.remove('hidden');
    shell.classList.add('open');
    shell.setAttribute('aria-hidden','false');
    document.body.classList.add('files-workspace-open');
    requestAnimationFrame(() => $('.files-workspace',shell)?.focus());
  }

  function closeDedicatedWorkspace(id) {
    const shell=$('#'+id);
    if(!shell)return;
    shell.classList.remove('open');
    shell.classList.add('hidden');
    shell.setAttribute('aria-hidden','true');
    if(!$$('.files-workspace-shell.open').length)document.body.classList.remove('files-workspace-open');
  }

  function closeApiWorkspace() { closeDedicatedWorkspace('api-workspace-shell'); }
  function closeBrainWorkspace() { closeDedicatedWorkspace('brain-workspace-shell'); }

  async function openApiWorkspace() {
    const shell=$('#api-workspace-shell'), body=$('#api-workspace-content');
    if(!shell||!body)return;
    openDedicatedWorkspace(shell);
    const endpoint=location.origin+'/v1';
    let latestOverview=null, latestInfo=null;
    const number=n=>fmtNum(Math.max(0,Number(n)||0));
    const shortDate=value=>{try{return new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});}catch(_){return value;}};
    const renderChart=chart=>{
      const points=(Array.isArray(chart)?chart:[]).map((d,i)=>({x:34+i*(692/13),v:Math.max(0,Number(d.input)||0)+Math.max(0,Number(d.output)||0),day:d.day}));
      const max=Math.max(1,...points.map(p=>p.v)), y=p=>142-(p.v/max)*108;
      const path=points.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+y(p).toFixed(1)).join(' ');
      const area=path+' L '+points[points.length-1].x.toFixed(1)+' 150 L '+points[0].x.toFixed(1)+' 150 Z';
      return '<div class="personal-api-chart-wrap"><svg class="personal-api-chart" viewBox="0 0 760 190" role="img" aria-label="Использование токенов за 14 дней"><defs><linearGradient id="api-token-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#6c7d9d" stop-opacity=".24"/><stop offset="100%" stop-color="#6c7d9d" stop-opacity=".01"/></linearGradient></defs>'+
        [34,70,106,142].map(gy=>'<line x1="28" x2="736" y1="'+gy+'" y2="'+gy+'" stroke="currentColor" stroke-opacity=".10"/>').join('')+
        '<path d="'+area+'" fill="url(#api-token-gradient)"/><path d="'+path+'" fill="none" stroke="#526b91" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+
        points.map(p=>'<circle cx="'+p.x.toFixed(1)+'" cy="'+y(p).toFixed(1)+'" r="3.1" fill="#526b91"><title>'+shortDate(p.day)+': '+number(p.v)+' токенов</title></circle>').join('')+
        points.filter((p,i)=>i%2===0||i===13).map(p=>'<text x="'+p.x.toFixed(1)+'" y="174" text-anchor="middle" fill="currentColor" fill-opacity=".58" font-size="10">'+shortDate(p.day)+'</text>').join('')+'</svg></div>';
    };
    const renderCostChart=chart=>{
      const points=(Array.isArray(chart)?chart:[]).map(d=>({day:d.day,value:Math.max(0,Number(d.cost)||0)}));
      const max=Math.max(0.000001,...points.map(p=>p.value));
      return '<div class="personal-api-cost-bars" role="img" aria-label="Стоимость запросов API по дням за 14 дней">'+points.map(p=>'<div class="personal-api-cost-bar-column"><div class="personal-api-cost-bar-value">'+(p.value?'$'+p.value.toFixed(6):'—')+'</div><div class="personal-api-cost-bar-track"><i style="height:'+Math.max(p.value?3:0,p.value/max*100)+'%"></i></div><span>'+shortDate(p.day)+'</span></div>').join('')+'</div>';
    };
    function renderDashboard(data,info,secret){
      latestOverview=data;latestInfo=info;
      const t=data.totals||{},balance=Math.max(0,Number(data.balance_tokens)||0);
      const chart=Array.isArray(data.chart)?data.chart:[];
      const rows=Array.isArray(data.recent)?data.recent:[];
      const keys=Array.isArray(data.keys)?data.keys:[];
      const activeKeyCount=keys.filter(k=>!k.is_revoked).length;
      const transactions=Array.isArray(data.transactions)?data.transactions:[];
      const guest=!data.can_create_keys;
      const statusText=info&&info.enabled?'API доступен для запросов':'API ожидает включения администратором';
      const keyMarkup=keys.length?keys.map(k=>{
        const used=Math.max(0,Number(k.tokens_used)||0), limit=k.token_limit===null||k.token_limit===undefined?null:Math.max(0,Number(k.token_limit)||0);
        const pct=limit===null?0:Math.min(100,limit?used/limit*100:100);
        const days=k.expires_at?Math.max(0,Math.ceil((Date.parse(k.expires_at)-Date.now())/86400000)):0;
        return '<article class="personal-api-key-card '+(!k.is_active?'is-disabled':'')+'" data-api-key-card="'+escapeHtml(k.id)+'">'+
          '<div class="personal-api-key-head"><span class="personal-api-key-icon">'+icon('key')+'</span><div class="personal-api-key-title"><b>'+escapeHtml(k.name)+'</b><small><code>'+escapeHtml(k.prefix)+'••••••••</code> · '+(k.is_revoked?'Отозван':k.is_active?'Активен':'Отключён')+'</small></div><span class="personal-api-key-status '+(k.is_active&&!k.is_revoked?'is-on':'')+'"></span></div>'+
          '<div class="personal-api-key-stats"><span>Использовано <b>'+number(used)+'</b></span><span>Лимит <b>'+(limit===null?'без отдельного лимита':number(limit))+'</b></span></div>'+
          '<div class="personal-api-key-progress"><i style="width:'+(limit===null?(used?'3':'0'):pct)+'%"></i></div>'+
          '<div class="personal-api-key-foot"><span>Ответ до '+number(k.max_output_tokens)+' токенов</span><span>'+(k.expires_at?(days?'Истекает через '+days+' дн.':'Срок истёк'):'Без срока действия')+'</span></div>'+
          '<div class="personal-api-key-actions">'+(k.is_revoked?'<span class="personal-api-revoked">Отозван · восстановление невозможно</span>':'<button type="button" class="chip-btn" data-key-config="'+escapeHtml(k.id)+'">'+icon('settings')+' Настроить</button><button type="button" class="chip-btn" data-key-toggle="'+escapeHtml(k.id)+'">'+(k.is_active?'Отключить':'Включить')+'</button><button type="button" class="chip-btn api-key-revoke" data-key-revoke="'+escapeHtml(k.id)+'">Отозвать</button>')+'</div>'+
          '<form class="personal-api-key-edit hidden" data-key-edit="'+escapeHtml(k.id)+'"><label>Название<input name="name" maxlength="80" required value="'+escapeHtml(k.name)+'"/></label><label>Лимит токенов<input name="token_limit" type="number" min="'+Math.max(1,used+Number(k.tokens_reserved||0))+'" max="1000000000" placeholder="Без отдельного лимита" value="'+(limit===null?'':limit)+'"/></label><label>Максимум токенов ответа<input name="max_output_tokens" type="number" min="1" max="32768" required value="'+number(k.max_output_tokens)+'"/></label><label>Срок действия<select name="expires_days"><option value="0" '+(!k.expires_at?'selected':'')+'>Без срока</option><option value="-1" '+(k.expires_at?'selected':'')+'>'+(days?'Сохранить текущий срок ('+days+' дн.)':'Срок истёк — не менять')+'</option><option value="1" '+(!k.expires_at&&days===1?'selected':'')+'>1 день</option><option value="7" '+(!k.expires_at&&days===7?'selected':'')+'>7 дней</option><option value="30" '+(!k.expires_at&&days===30?'selected':'')+'>30 дней</option><option value="90" '+(!k.expires_at&&days===90?'selected':'')+'>90 дней</option><option value="365" '+(!k.expires_at&&days===365?'selected':'')+'>1 год</option></select></label><button class="api-primary-action" type="submit">'+icon('check')+' Сохранить параметры</button></form></article>';
      }).join(''):'<div class="personal-api-empty"><span>'+icon('key')+'</span><b>Здесь появятся ваши API-ключи</b><p>Создайте отдельный ключ для своего приложения и установите для него собственный предел.</p></div>';
      const recentMarkup=rows.length?'<div class="personal-api-table-wrap"><table class="personal-api-table"><thead><tr><th>Время</th><th>Ключ</th><th>Вход</th><th>Выход</th><th>Всего</th><th>Стоимость провайдера</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escapeHtml(String(r.created_at||'').replace('T',' ').slice(0,16))+'</td><td><code>'+escapeHtml(r.key_prefix||'—')+'</code></td><td>'+number(r.tokens_in)+'</td><td>'+number(r.tokens_out)+'</td><td><b>'+number(r.tokens_total)+'</b></td><td>$'+Number(r.cost_usd||0).toFixed(6)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="personal-api-muted">Запросов пока нет. После первого обращения статистика появится здесь.</p>';
      const transactionMarkup=transactions.length?'<div class="personal-api-table-wrap"><table class="personal-api-table"><thead><tr><th>Дата</th><th>Операция</th><th>Изменение</th><th>Баланс после</th><th>Описание</th></tr></thead><tbody>'+transactions.map(t=>'<tr><td>'+escapeHtml(String(t.created_at||'').replace('T',' ').slice(0,16))+'</td><td>'+escapeHtml(t.action==='admin_grant'?'Пополнение':t.action==='signup_grant'?'Стартовые токены':t.action==='migration_grant'?'Стартовые токены после обновления':t.action==='api_usage'?'Расход API':t.action)+'</td><td><b class="'+(Number(t.amount)>=0?'token-amount-positive':'token-amount-negative')+'">'+(Number(t.amount)>0?'+':'')+number(t.amount)+'</b></td><td>'+number(t.balance_after)+'</td><td>'+escapeHtml(t.reason||'—')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="personal-api-muted">Операций по балансу ещё нет.</p>';
      body.innerHTML='<div class="personal-api-shell">'+
        '<section class="personal-api-hero"><div class="personal-api-eyebrow">AI CH · API WORKSPACE</div><div class="personal-api-hero-grid"><div><h1>Ваш AI CH API</h1><p>Личные ключи, расход токенов и контроль каждого подключения в одном месте. Настоящие модели и маршрутизация остаются на стороне AI CH.</p><div class="personal-api-status"><span class="personal-api-status-dot '+(info&&info.enabled?'is-on':'')+'"></span><span>'+escapeHtml(statusText)+'</span><span class="personal-api-public-model">Модель <code>ai-ch</code></span></div></div><div class="personal-api-wallet"><span>'+icon('wallet')+' Доступный баланс</span><b>'+number(balance)+'</b><small>токенов</small><div class="personal-api-wallet-track"><i style="width:'+(balance?Math.min(100,balance/30000*100):0)+'%"></i></div><p>Стартовые 30 000 токенов выдаются после регистрации. Дальнейшее пополнение — через администратора.</p></div></div></section>'+
        (guest?'<section class="personal-api-register"><div><b>Зарегистрируйтесь, чтобы создать личный ключ</b><p>Гостевой режим не получает стартовый API-баланс и не позволяет создавать ключи.</p></div><button type="button" class="api-primary-action" data-api-register>Зарегистрироваться</button></section>':'')+
        '<section class="personal-api-metrics"><article><span>Всего запросов</span><b>'+number(t.calls)+'</b><small>по личным ключам</small></article><article><span>Израсходовано токенов</span><b>'+number(t.tokens_total)+'</b><small>вход + выход</small></article><article><span>Входные токены</span><b>'+number(t.tokens_in)+'</b><small>история запросов</small></article><article><span>Выходные токены</span><b>'+number(t.tokens_out)+'</b><small>ответы модели</small></article></section>'+
        '<section class="personal-api-section"><div class="personal-api-section-head"><div><span class="personal-api-overline">01 · АНАЛИТИКА</span><h2>Расходы за 14 дней</h2><p>Количество использованных токенов и расчётная стоимость вызовов модели.</p></div><button type="button" class="chip-btn" data-api-refresh>'+icon('refresh')+' Обновить</button></div><div class="personal-api-chart-grid"><div class="personal-api-chart-card"><div class="personal-api-chart-legend"><span><i></i> Вход + выход, токены</span><b>'+number(t.tokens_total)+'</b></div>'+renderChart(chart)+'</div><div class="personal-api-chart-card"><div class="personal-api-chart-legend"><span><i class="is-cost"></i> Стоимость провайдера</span><b>$'+Number(t.cost_usd||0).toFixed(6)+'</b></div>'+renderCostChart(chart)+'</div></div><p class="personal-api-muted">Стоимость показывает расчётные затраты на модель, а не отдельное денежное списание с токенового баланса.</p></section>'+
        '<section class="personal-api-section"><div class="personal-api-section-head"><div><span class="personal-api-overline">02 · ДОСТУП</span><h2>Ваши API-ключи</h2><p>Создавайте отдельные ключи для приложений, ограничивайте расход и отключайте ненужные.</p></div><span class="personal-api-count">'+activeKeyCount+' / 20</span></div>'+
        (!guest?'<form class="personal-api-create" id="personal-api-create"><div class="personal-api-create-intro"><span class="personal-api-create-icon">'+icon('key')+'</span><div><b>Создать новый ключ</b><p>Полный секрет появится один раз — сразу скопируйте его и сохраните в безопасном месте.</p></div></div><div class="personal-api-form-grid"><label>Название ключа<input name="name" maxlength="80" required placeholder="Например, мой сайт" /></label><label>Лимит ключа, токенов<input name="token_limit" type="number" min="1" max="1000000000" placeholder="Ограничить расход (необязательно)" /></label><label>Максимальный ответ<select name="max_output_tokens"><option value="512">512 токенов</option><option value="1024">1 024 токена</option><option value="2048" selected>2 048 токенов</option><option value="4096">4 096 токенов</option><option value="8192">8 192 токена</option><option value="16384">16 384 токена</option><option value="32768">32 768 токенов</option></select></label><label>Срок действия<select name="expires_days"><option value="0" selected>Без срока</option><option value="1">1 день</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="365">1 год</option></select></label></div><div class="personal-api-create-footer"><span>Лимит ключа не может увеличить баланс аккаунта.</span><button type="submit" class="api-primary-action" '+(activeKeyCount>=20?'disabled':'')+'>'+icon('plus')+' Создать ключ</button></div><div id="personal-api-created-secret">'+(secret?'<div class="personal-api-secret"><b>'+icon('shield-check')+' Скопируйте новый ключ сейчас</b><p>После закрытия этого сообщения восстановить секрет будет нельзя.</p><div><code>'+escapeHtml(secret)+'</code><button type="button" class="api-primary-action" data-copy-created-key>'+icon('copy')+' Копировать</button></div></div>':'')+'</div></form>':'')+
        '<div class="personal-api-key-list">'+keyMarkup+'</div></section>'+
        '<section class="personal-api-section"><div class="personal-api-section-head"><div><span class="personal-api-overline">03 · ЖУРНАЛ</span><h2>Последние запросы</h2><p>Каждый запрос привязан к вашему аккаунту и, если возможно, к ключу-источнику.</p></div></div>'+recentMarkup+'</section>'+
        '<section class="personal-api-section"><div class="personal-api-section-head"><div><span class="personal-api-overline">04 · БАЛАНС</span><h2>История баланса</h2><p>Начисления, пополнения и списания API по вашему аккаунту.</p></div></div>'+transactionMarkup+'</section>'+
        '<section class="personal-api-connection"><span class="personal-api-overline">04 · ПОДКЛЮЧЕНИЕ</span><h2>Готово к интеграции</h2><p>Совместимый интерфейс Chat Completions. Запросы списывают токены с баланса и ограничиваются настройками ключа.</p><div class="personal-api-endpoint"><div><span>Base URL</span><code>'+escapeHtml(endpoint)+'</code></div><button class="chip-btn" type="button" data-copy-base-url>'+icon('copy')+' Копировать</button></div><div class="personal-api-protocol-grid"><article><span>01</span><b>Личная авторизация</b><p>Используйте созданный в этой странице ключ в заголовке Bearer.</p></article><article><span>02</span><b>Контроль токенов</b><p>Баланс и лимит отдельного ключа проверяются до обращения к модели.</p></article><article><span>03</span><b>Потоковый ответ</b><p>Поддерживается обычный JSON-ответ и потоковая передача SSE.</p></article></div>'+'<details class="personal-api-example"><summary>Показать пример запроса</summary><pre><code>curl '+escapeHtml(endpoint)+'/chat/completions -H &quot;Authorization: Bearer YOUR_API_KEY&quot; -H &quot;Content-Type: application/json&quot; -d &quot;{&#92;&quot;model&#92;&quot;:&#92;&quot;ai-ch&#92;&quot;,&#92;&quot;messages&#92;&quot;:[{&#92;&quot;role&#92;&quot;:&#92;&quot;user&#92;&quot;,&#92;&quot;content&#92;&quot;:&#92;&quot;Привет&#92;&quot;}],&#92;&quot;max_tokens&#92;&quot;:512}&quot;</code></pre></details></section></div>';
    }
    let pendingCreatedSecret='';
    async function loadDashboard(secret){
      if(secret)pendingCreatedSecret=secret;
      try{
        const results=await Promise.all([api.get('/api/my-api/overview'),api.get('/v1/info')]);
        renderDashboard(results[0],results[1],pendingCreatedSecret);
      }catch(error){
        const secretMarkup=pendingCreatedSecret?'<div class="personal-api-secret" id="personal-api-created-secret"><b>'+icon('shield-check')+' Сохраните созданный API-ключ</b><p>Секрет показывается только после создания. Скопируйте его до закрытия страницы.</p><div><code>'+escapeHtml(pendingCreatedSecret)+'</code><button type="button" class="api-primary-action" data-copy-created-key>'+icon('copy')+' Копировать</button></div></div>':'';
        body.innerHTML='<section class="personal-api-error"><span>'+icon('alert')+'</span><h2>Не удалось загрузить API</h2><p>'+escapeHtml(error.message||'Ошибка загрузки')+'</p><button type="button" class="api-primary-action" data-api-refresh>Повторить</button>'+secretMarkup+'</section>';
      }
    }
    body.onclick=async event=>{
      const target=event.target;
      const refresh=target.closest('[data-api-refresh]');if(refresh){await loadDashboard();return;}
      if(target.closest('[data-api-register]')){$('#register-btn')?.click();return;}
      const copyKey=target.closest('[data-copy-created-key]');
      if(copyKey){const secret=$('#personal-api-created-secret code',body)?.textContent||'';try{await navigator.clipboard.writeText(secret);toast('Ключ скопирован');}catch(_){toast('Не удалось скопировать ключ','error');}return;}
      if(target.closest('[data-copy-base-url]')){try{await navigator.clipboard.writeText(endpoint);toast('Base URL скопирован');}catch(_){toast(endpoint);}return;}
      const configure=target.closest('[data-key-config]');
      if(configure){const form=$('[data-key-edit="'+configure.dataset.keyConfig+'"]',body);if(form)form.classList.toggle('hidden');return;}
      const toggle=target.closest('[data-key-toggle]');
      if(toggle){
        const key=latestOverview&&latestOverview.keys.find(k=>k.id===toggle.dataset.keyToggle);if(!key)return;
        toggle.disabled=true;try{await api.patch('/api/my-api/keys/'+encodeURIComponent(key.id),{is_active:!key.is_active});toast(!key.is_active?'Ключ включён':'Ключ отключён');await loadDashboard();}catch(e){toast('Ошибка: '+e.message,'error');toggle.disabled=false;}return;
      }
      const revoke=target.closest('[data-key-revoke]');
      if(revoke){
        const key=latestOverview&&latestOverview.keys.find(k=>k.id===revoke.dataset.keyRevoke);if(!key)return;
        openModal({title:'Отозвать API-ключ?',okText:'Отмена',extraClass:'token-topup-modal',
          body:'<p class="usage-note">Ключ «'+escapeHtml(key.name)+'» перестанет работать во всех приложениях, где он используется. Это действие нельзя отменить.</p><button type="button" class="api-primary-action" id="api-key-confirm-revoke">'+icon('key')+' Отозвать ключ</button>',
          onOk:()=>true});
        $('#api-key-confirm-revoke')?.addEventListener('click',async buttonEvent=>{
          const confirmButton=buttonEvent.currentTarget;confirmButton.disabled=true;
          try{await api.del('/api/my-api/keys/'+encodeURIComponent(key.id));$('#modal-root').innerHTML='';toast('Ключ отозван');await loadDashboard();}
          catch(error){toast('Ошибка: '+error.message,'error');confirmButton.disabled=false;}
        });
        return;
      }
      const admin=target.closest('[data-api-admin-config]');if(admin)openApiAdminSettings();
    };
    body.onsubmit=async event=>{
      const form=event.target.closest('#personal-api-create,[data-key-edit]');
      if(!form)return;
      event.preventDefault();
      const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
      const values=new FormData(form);
      try{
        if(form.id==='personal-api-create'){
          const payload={name:String(values.get('name')||'').trim(),token_limit:String(values.get('token_limit')||'').trim()||null,max_output_tokens:Number(values.get('max_output_tokens')||2048),expires_days:Number(values.get('expires_days')||0)};
          const result=await api.post('/api/my-api/keys',payload);
          toast('API-ключ создан. Сохраните его сейчас.');
          await loadDashboard(result.api_key);
        }else{
          const id=form.dataset.keyEdit;
          await api.patch('/api/my-api/keys/'+encodeURIComponent(id),{
            name:String(values.get('name')||'').trim(),
            token_limit:String(values.get('token_limit')||'').trim()||null,
            max_output_tokens:Number(values.get('max_output_tokens')||2048),
            expires_days:Number(values.get('expires_days')||0)
          });
          toast('Параметры ключа сохранены');await loadDashboard();
        }
      }catch(error){toast('Не удалось сохранить: '+error.message,'error');if(submit)submit.disabled=false;}
    };
    const refresh=$('#api-workspace-refresh');if(refresh)refresh.onclick=()=>loadDashboard();
    await loadDashboard();
  }

  function closeCapabilitiesWorkspace() { closeDedicatedWorkspace('capabilities-workspace-shell'); }

  function openCapabilitiesWorkspace() {
    const shell=$('#capabilities-workspace-shell'), body=$('#capabilities-workspace-content');
    if(!shell||!body)return;
    openDedicatedWorkspace(shell);
    const feature=(symbol,title,tag,description,items)=>'<article class="capability-card"><span class="capability-card-icon">'+icon(symbol)+'</span><div class="capability-card-copy"><span class="capability-card-tag">'+escapeHtml(tag)+'</span><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(description)+'</p><ul>'+items.map(item=>'<li>'+escapeHtml(item)+'</li>').join('')+'</ul></div></article>';
    const workflow=[
      ['1','Запрос','Текст, изображения, файлы или голос'],
      ['2','Контекст','История чата и релевантная память'],
      ['3','Модель','План ответа и выбор нужного действия'],
      ['4','Инструменты','Поиск, документы, код и подключения'],
      ['5','Проверка','Соблюдение формата и ограничений'],
      ['6','Результат','Ответ, блоки, схема или готовый файл']
    ];
    body.innerHTML=
      '<div class="capabilities-shell">'+
      '<section class="capabilities-hero"><div class="capabilities-hero-grid"><div><div class="capabilities-eyebrow">AI CH · ВОЗМОЖНОСТИ</div><h1>От первого вопроса до готового результата</h1><p>AI CH объединяет диалог, работу с файлами, поиск, личные знания и инструменты в одном рабочем пространстве. Откройте любой раздел ниже, чтобы увидеть, как его можно использовать.</p><div class="capabilities-hero-pills"><span>'+icon('chat')+' Диалог</span><span>'+icon('file-text')+' Документы</span><span>'+icon('network')+' Инструменты</span></div></div><div class="capabilities-hero-visual" aria-hidden="true"><div class="capabilities-glow"></div><div class="capabilities-orbit capabilities-orbit-one"></div><div class="capabilities-orbit capabilities-orbit-two"></div><div class="capabilities-hero-core">'+icon('sparkle')+'<b>AI CH</b><small>Ваша рабочая среда</small></div><span class="capabilities-float capabilities-float-a">'+icon('file-text')+'</span><span class="capabilities-float capabilities-float-b">'+icon('mic')+'</span><span class="capabilities-float capabilities-float-c">'+icon('chart-line')+'</span></div></div></section>'+
      '<section class="capabilities-section"><div class="capabilities-section-title"><div><span class="capabilities-overline">01 · КАК ЭТО РАБОТАЕТ</span><h2>Путь от вопроса к результату</h2><p>Листайте схему по горизонтали — каждый шаг превращает запрос в полезный результат.</p></div><span class="capabilities-side-hint">'+icon('arrow-right')+' Прокручиваемая схема</span></div><div class="capabilities-flow-scroll" tabindex="0" aria-label="Прокручиваемая схема работы AI CH"><div class="capabilities-flow">'+workflow.map((item,i)=>'<article class="capabilities-flow-node"><span class="capabilities-flow-number">'+item[0]+'</span><b>'+item[1]+'</b><p>'+item[2]+'</p></article>'+(i<workflow.length-1?'<span class="capabilities-flow-arrow">'+icon('arrow-right')+'</span>':'')).join('')+'</div></div><div class="capabilities-flow-caption"><span>'+icon('shield-check')+' Инструменты используются только там, где они подходят задаче.</span><span>Прокрутите вправо, чтобы увидеть все этапы →</span></div></section>'+
      '<section class="capabilities-section"><div class="capabilities-section-title"><div><span class="capabilities-overline">02 · ОСНОВНЫЕ ВОЗМОЖНОСТИ</span><h2>Одно место — разные задачи</h2><p>Выберите подходящий сценарий. История и ваши материалы остаются частью рабочего процесса.</p></div></div><div class="capabilities-card-grid">'+
      feature('message-circle','Умный диалог','ОТВЕТЫ','Обсуждайте сложные темы, задавайте уточняющие вопросы и развивайте мысль в том же чате.',['Постепенная передача ответа по мере генерации','Продолжение диалога с учётом истории','Редактирование, повтор и продолжение ответа','Поддержка форматированного текста, таблиц и кода'])+
      feature('image','Изображения и файлы','МУЛЬТИМОДАЛЬНОСТЬ','Прикрепляйте исходные материалы и используйте их как контекст для задачи.',['Изображения и документы как входные данные','Объяснение содержимого и извлечение полезных деталей','Работа с несколькими вложениями','Файлы ответа можно сохранить в разделе «Файлы»'])+
      feature('file-stack','Готовые документы','СОЗДАНИЕ','Попросите подготовить материал в удобном для передачи или дальнейшего редактирования формате.',['Документы DOCX и PDF','Таблицы XLSX','Презентации PPTX','Изображения и схемы PNG/SVG, когда подходят задаче'])+
      feature('globe','Поиск в интернете','АКТУАЛЬНЫЕ ДАННЫЕ','Для вопросов, требующих внешних сведений, AI CH может использовать интернет-поиск и источники.',['Поиск по теме или конкретному вопросу','Ссылки на найденные материалы, когда они доступны','Сведение нескольких источников в общий ответ','Уточнение контекста перед подготовкой результата'])+
      feature('mic','Голос и аудио','ГОЛОС','Взаимодействуйте с AI CH голосом и прослушивайте ответы, не меняя рабочий контекст.',['Голосовой ввод и преобразование речи в текст','Озвучивание ответов','Управление воспроизведением в чате','Отдельные аудио-функции могут зависеть от доступных лимитов'])+
      feature('chart-no-axes-combined','Визуальные блоки','ИНТЕРАКТИВНЫЕ ОТВЕТЫ','Ответы могут включать не только абзацы, но и структурированные элементы.',['Карточки, таблицы и блоки кода','Графики, диаграммы и схемы','Тесты, вопросы и интерактивные варианты там, где поддерживается формат','Кнопки запуска для поддерживаемого кода и артефактов'])+
      feature('folder-kanban','Проекты и файлы','ОРГАНИЗАЦИЯ','Храните работу по задачам и быстро возвращайтесь к созданным материалам.',['Проекты и связанные чаты','Общий список загруженных и созданных файлов','Сохранение вложений в аккаунте','Переименование, поиск и управление историей чатов'])+
      feature('brain','Память','ЛИЧНЫЙ КОНТЕКСТ','AI CH может учитывать сохранённые факты и предпочтения, чтобы не начинать каждый разговор с нуля.',['Отдельный раздел сохранённых воспоминаний','Просмотр и управление записями','Использование подходящего контекста при ответе','Память помогает персонализировать последующие диалоги'])+
      feature('network','Второй мозг','БЕТА','Создавайте личную карту знаний, в которой заметки и идеи соединяются отношениями.',['Визуальные узлы и связи','Редактирование описаний и отношений','Поиск по карте знаний','Личное пространство в аккаунте; функция находится в бета-версии'])+
      feature('plug','Коннекторы','ВНЕШНИЕ СЕРВИСЫ','Подключайте доступные интеграции, чтобы работать с разрешёнными внешними данными.',['Управление подключениями в отдельном разделе','Интеграция с GitHub для поддерживаемых репозиториев','Доступ зависит от выданных разрешений и настроенного коннектора','Секреты подключения не следует передавать в сообщения'])+
      feature('sparkles','Навыки','СЦЕНАРИИ РАБОТЫ','Используйте готовые и собственные инструкции для повторяющихся типов задач.',['Системные навыки и пользовательские навыки','Отдельный раздел управления','Переиспользование инструкции без копирования длинного запроса','Доступные навыки зависят от текущей конфигурации'])+
      feature('calendar-clock','Запланировано','ПЛАНИРОВАНИЕ','Держите напоминания и будущие действия в одном месте.',['Список запланированных записей','Управление напоминаниями','Контекст для поддерживаемых календарных сценариев','Просмотр и изменение сохранённых элементов'])+
      feature('code-2','Код и технические задачи','РАЗРАБОТКА','Попросите объяснить код, подготовить фрагмент или помочь разобрать ошибку.',['Разбор кода и ошибок','Подготовка команд и тестовых примеров','Вызов инструментов выполнения только при доступной конфигурации','Сохранение полезных фрагментов и файлов в чате'])+
      feature('key-round','API AI CH','ИНТЕГРАЦИИ','Используйте AI CH из собственного приложения с индивидуальным ключом.',['Совместимый API формата Chat Completions','Отдельные ключи и их ограничения','Баланс и статистика расхода в токенах','Проверка баланса и лимита до обращения к модели'])+
      feature('share-2','Совместное использование','ОБМЕН','Упрощайте передачу результата и возвращайтесь к предыдущим решениям.',['Копирование текста ответа','Поддерживаемая ссылка на общий чат','Ответы можно оформить так, чтобы ими было удобно делиться','Управление ссылкой зависит от настроек чата'])+
      '</div></section>'+
      '<section class="capabilities-section"><div class="capabilities-section-title"><div><span class="capabilities-overline">03 · СТРУКТУРИРОВАННАЯ РАБОТА</span><h2>Результаты, которые можно продолжить использовать</h2><p>AI CH помогает пройти весь цикл — от материалов до готового файла и дальнейших правок.</p></div></div><div class="capabilities-artifact-flow" tabindex="0" aria-label="Прокручиваемая схема создания результата"><article><span>'+icon('chat')+'</span><b>Поставьте задачу</b><p>Опишите цель, формат и ограничения.</p></article><i>'+icon('arrow-right')+'</i><article><span>'+icon('paperclip')+'</span><b>Добавьте контекст</b><p>Прикрепите исходники, изображения или документы.</p></article><i>'+icon('arrow-right')+'</i><article><span>'+icon('workflow')+'</span><b>Уточните структуру</b><p>Согласуйте разделы, данные или порядок действий.</p></article><i>'+icon('arrow-right')+'</i><article><span>'+icon('check-circle')+'</span><b>Получите результат</b><p>Сохраните файл, проверьте и попросите внести изменения.</p></article></div></section>'+
      '<section class="capabilities-footer"><div><span class="capabilities-footer-icon">'+icon('compass')+'</span><div><h2>Начните с любой задачи</h2><p>Выберите сценарий в AI CH — остальные инструменты находятся в боковой панели. Возможности конкретного запроса зависят от доступности моделей, подключений и лимитов аккаунта.</p></div></div><button type="button" class="api-primary-action" id="capabilities-start-chat">'+icon('plus')+' Новый чат</button></section></div>';
    body.onclick=event=>{
      if(event.target.closest('#capabilities-start-chat')){closeCapabilitiesWorkspace();newChat('chat');}
    };
  }

  async function openApiAdminSettings() {
    const endpoint=location.origin+'/v1';
    let sets,config;
    try{
      const data=await Promise.all([api.get('/api/admin/model-sets'),api.get('/api/admin/api-gateway')]);
      sets=data[0].filter(s=>s.route_type==='MAIN'&&!s.is_router&&s.is_active&&(s.entries||[]).some(e=>e.is_active&&e.base_url&&e.model));
      config=data[1];
    }catch(e){toast('Не удалось открыть API: '+e.message,'error');return;}
    const selected=sets.find(s=>s.id===config.model_set_id)||sets[0]||null;
    const opts=sets.map(s=>'<option value="'+escapeHtml(s.id)+'"'+(selected&&selected.id===s.id?' selected':'')+'>'+escapeHtml(s.name)+'</option>').join('');
    const p=config.prices||{},u=config.usage||{},recent=config.recent||[];
    const costLabel=n=>'$'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:8})+' / 1M';
    openModal({title:'API · настройки и расходы',okText:'Закрыть',extraClass:'wide api-workspace-modal',
      body:'<section class="api-hero"><div class="api-hero-icon">'+icon('plug')+'</div><div><h4>OpenAI-совместимый API</h4><p>Здесь администратор настраивает маршрутизацию и тарифы. Каждый пользователь управляет собственными ключами на странице API.</p></div></section>'+
        '<div class="api-settings-grid"><label><span>Модель / кластер</span><select id="gateway-model-set">'+opts+'</select></label>'+
        '<label class="api-enabled-setting"><span>Состояние API</span><span><input id="gateway-enabled" type="checkbox"'+(config.enabled?' checked':'')+'> Включён для запросов с ключом</span></label>'+
        '<label><span>Input, $ / млн токенов</span><input id="gateway-price-in" type="number" min="0" step="any" value="'+escapeHtml(String(p.input??0))+'"></label>'+
        '<label><span>Output, $ / млн токенов</span><input id="gateway-price-out" type="number" min="0" step="any" value="'+escapeHtml(String(p.output??0))+'"></label>'+
        '<label><span>Cache read, $ / млн токенов</span><input id="gateway-price-cache" type="number" min="0" step="any" value="'+escapeHtml(String(p.cache_read??0))+'"></label></div>'+
        '<p class="usage-note">Стоимость учитывается отдельным журналом для /v1. Цены берутся из Model Sets до первого сохранения собственных цен API.</p>'+
        '<div class="row api-form-actions"><button type="button" class="chip-btn" id="gateway-save">'+icon('check')+'Сохранить</button><span class="usage-note">Личные ключи пользователи создают в разделе API.</span><button type="button" class="chip-btn" id="gateway-open-models">Model Sets и цены</button></div>'+
        '<p class="usage-note">Общие API-ключи отключены. Каждый пользователь создаёт и отзывает свои ключи на личной странице API.</p>'+
        '<h4 class="sec">Адрес и формат запроса</h4><div class="api-endpoint-card"><span>Base URL</span><code>'+escapeHtml(endpoint)+'</code><button class="chip-btn" type="button" data-copy-api-endpoint>Копировать</button></div>'+
        '<pre class="api-code"><code>curl '+escapeHtml(endpoint)+'/chat/completions \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d &#39;{"model":"ai-ch","messages":[{"role":"user","content":"Привет"}],"stream":false}&#39;</code></pre>'+
        '<p class="usage-note">Поддерживаются <code>/v1/models</code>, <code>/v1/chat/completions</code>, JSON и SSE-поток.</p>'+
        '<h4 class="sec">Суммарные расходы</h4><div class="usage-grid api-usage-grid"><div class="usage-card"><span>Вызовы</span><b>'+fmtNum(u.calls||0)+'</b></div>'+
        '<div class="usage-card"><span>Input</span><b>'+fmtNum(u.tokens_in||0)+'</b></div><div class="usage-card"><span>Output</span><b>'+fmtNum(u.tokens_out||0)+'</b></div>'+
        '<div class="usage-card"><span>Cache read</span><b>'+fmtNum(u.tokens_cached||0)+'</b></div><div class="usage-card"><span>Итого</span><b>$'+Number(u.cost_usd||0).toFixed(6)+'</b></div>'+
        '<div class="usage-card"><span>Эффективная цена</span><b>'+costLabel(p.input)+' input</b><small>'+costLabel(p.output)+' output · '+costLabel(p.cache_read)+' cache</small></div></div>'+
        '<h4 class="sec">Последние запросы</h4><div class="api-recent-list">'+(recent.length?recent.map(r=>'<div class="api-recent-row"><span>'+escapeHtml(String(r.created_at||'').replace('T',' ').slice(0,19))+'<small>'+escapeHtml(r.model||'')+'</small></span>'+
          '<span>вх. '+fmtNum(r.tokens_in)+' · вых. '+fmtNum(r.tokens_out)+' · cache '+fmtNum(r.tokens_cached)+'</span><b>$'+Number(r.cost_usd||0).toFixed(6)+'</b></div>').join(''):'<p class="usage-note">Запросов через /v1 пока не было.</p>')+'</div>',
      onOk:()=>true});
    const root=$('#modal-root'), select=$('#gateway-model-set');
    function sourceEntry(){const set=sets.find(s=>s.id===(select&&select.value));return set&&(set.entries||[]).find(e=>e.is_active&&e.base_url&&e.model);}
    for(const id of ['gateway-price-in','gateway-price-out','gateway-price-cache'])$('#'+id,root).addEventListener('input',e=>{e.currentTarget.dataset.edited='1';});
    if(select)select.addEventListener('change',()=>{
      const entry=sourceEntry();if(!entry)return;
      [['gateway-price-in','price_in'],['gateway-price-out','price_out'],['gateway-price-cache','price_cache']].forEach(([id,key])=>{
        const input=$('#'+id,root);if(input.dataset.edited!=='1')input.value=Number(entry[key]||0);
      });
    });
    $('#gateway-save',root).addEventListener('click',async e=>{
      const button=e.currentTarget;button.disabled=true;
      try{
        await api.patch('/api/admin/api-gateway',{enabled:$('#gateway-enabled',root).checked,model_set_id:select?(select.value||null):null,
          price_in:Math.max(0,Number($('#gateway-price-in',root).value)||0),price_out:Math.max(0,Number($('#gateway-price-out',root).value)||0),
          price_cache:Math.max(0,Number($('#gateway-price-cache',root).value)||0)});
        toast('Настройки API сохранены');await openApiAdminSettings();
      }catch(err){toast('Не удалось сохранить: '+err.message,'error');button.disabled=false;}
    });
    $('#gateway-open-models',root).addEventListener('click',()=>{$('#modal-root').innerHTML='';openModelSetsAdmin();});
    root.addEventListener('click',async e=>{if(!e.target.closest('[data-copy-api-endpoint]'))return;try{await navigator.clipboard.writeText(endpoint);toast('Адрес API скопирован');}catch(_){toast(endpoint);}});
  }

  async function openSecondBrain() {
    const root=$('#brain-workspace-shell'), body=$('#brain-workspace-content');
    const starter=()=>({version:1,nodes:[
      {id:'input',title:'Запрос',kind:'Вход',description:'Текст вопроса и прикреплённые файлы'},
      {id:'memory',title:'Память',kind:'Контекст',description:'Сохранённые факты и предпочтения'},
      {id:'model',title:'Основная модель',kind:'ИИ',description:'Обрабатывает вопрос и строит ответ'},
      {id:'tools',title:'Инструменты',kind:'Действия',description:'Поиск, код, файлы и коннекторы'},
      {id:'check',title:'Проверка результата',kind:'Контроль',description:'Проверяет полноту и формат'},
      {id:'output',title:'Ответ',kind:'Результат',description:'Текст, интерактивные блоки и файлы'}],
      edges:[
      {id:'e1',from:'input',to:'memory',relation:'По запросу подбирается подходящий контекст'},
      {id:'e2',from:'memory',to:'model',relation:'Память передаёт факты и предпочтения основной модели'},
      {id:'e3',from:'model',to:'tools',relation:'Модель вызывает нужный инструмент'},
      {id:'e4',from:'tools',to:'model',relation:'Результаты инструмента возвращаются модели'},
      {id:'e5',from:'model',to:'check',relation:'Черновик проверяется на полноту'},
      {id:'e6',from:'check',to:'output',relation:'Проверенный результат показывается пользователю'}]});
    let graph=starter();
    try{const result=await api.get('/api/brain-graph');if(result&&result.graph&&Array.isArray(result.graph.nodes)&&result.graph.nodes.length)graph=result.graph;}
    catch(e){toast('Не удалось загрузить Второй мозг: '+e.message,'error');return;}
    graph.nodes=Array.isArray(graph.nodes)?graph.nodes:[];graph.edges=Array.isArray(graph.edges)?graph.edges:[];
    body.innerHTML='<section class="brain-page-intro"><div class="brain-page-kicker">PERSONAL KNOWLEDGE MAP</div><h1>Ваша карта знаний</h1><p>Собирайте связанные заметки и идеи. Эта карта хранится в вашем аккаунте; системные связи AI CH настраиваются отдельно в административной панели.</p><div class="brain-page-benefits"><span>'+icon('network')+' Узлы и связи</span><span>'+icon('database')+' Личное хранение</span><span>'+icon('search')+' Поиск по карте</span></div><div class="brain-page-toolbar"><label class="brain-page-search">'+icon('search')+'<input id="brain-personal-search" type="search" placeholder="Найти блок или связь…"></label><span class="brain-page-private">'+icon('lock')+' Только вы видите личную карту</span></div><div id="brain-graph-editor"></div></section>';
    openDedicatedWorkspace(root);
    let revision=0;
    const esc=x=>escapeHtml(String(x==null?'':x));
    const label=id=>{const node=graph.nodes.find(n=>n.id===id);return node?node.title:'Неизвестный блок';};
    async function save(){
      const current=++revision, status=$('#brain-save-status',root);if(status)status.textContent='Сохранение…';
      try{await api.put('/api/brain-graph',{graph});if(current===revision&&$('#brain-save-status',root))$('#brain-save-status',root).textContent='Сохранено';}
      catch(err){if($('#brain-save-status',root))$('#brain-save-status',root).textContent='Ошибка сохранения';toast('Не удалось сохранить схему: '+err.message,'error');}
    }
    function render(){
      const needle=($('#brain-personal-search',root)?.value||'').trim().toLocaleLowerCase();
      const visibleNodes=needle?graph.nodes.filter(n=>(String(n.title||'')+' '+String(n.kind||'')+' '+String(n.description||'')).toLocaleLowerCase().includes(needle)):graph.nodes;
      const visibleIds=new Set(visibleNodes.map(n=>String(n.id)));
      const visibleEdges=needle?graph.edges.filter(e=>(String(e.relation||'')).toLocaleLowerCase().includes(needle)||(visibleIds.has(String(e.from))&&visibleIds.has(String(e.to)))):graph.edges;
      const nodes=visibleNodes.map(n=>'<article class="brain-node"><div class="brain-node-head"><span>'+esc(n.kind||'Блок')+'</span><button type="button" data-brain-delete-node="'+esc(n.id)+'" title="Удалить блок">×</button></div><h4>'+esc(n.title)+'</h4><p>'+esc(n.description||'')+'</p></article>').join('');
      const options=graph.nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.title)+'</option>').join('');
      const edges=visibleEdges.map(e=>'<div class="brain-edge"><div class="brain-edge-route"><b>'+esc(label(e.from))+'</b><span>→</span><b>'+esc(label(e.to))+'</b><button type="button" data-brain-delete-edge="'+esc(e.id)+'" aria-label="Удалить связь">×</button></div><p>'+esc(e.relation||'Без описания')+'</p></div>').join('');
      $('#brain-graph-editor',root).innerHTML='<p class="usage-note">Блок — узел системы. Связь описывает, что именно передаётся между узлами. Изменения хранятся в аккаунте.</p>'+
        '<div class="brain-graph-canvas">'+(nodes||'<p>Нет блоков.</p>')+'</div><h4 class="sec">Связи</h4><div class="brain-edges">'+(edges||'<p class="usage-note">Нет связей.</p>')+'</div>'+
        '<details class="brain-add-details" open><summary>Добавить блок</summary><div class="brain-add-grid"><label>Название<input id="brain-node-title" maxlength="100" placeholder="Например, Проверка фактов"></label><label>Тип<input id="brain-node-kind" maxlength="40" placeholder="Например, Инструмент"></label>'+
        '<label class="brain-wide">Что делает блок<textarea id="brain-node-description" rows="2" maxlength="600" placeholder="Назначение блока обычным языком"></textarea></label><button type="button" class="chip-btn" id="brain-add-node">Добавить блок</button></div></details>'+
        '<details class="brain-add-details" open><summary>Добавить связь</summary><div class="brain-add-grid"><label>Откуда<select id="brain-edge-from">'+options+'</select></label><label>Куда<select id="brain-edge-to">'+options+'</select></label>'+
        '<label class="brain-wide">Как связаны<textarea id="brain-edge-relation" rows="2" maxlength="600" placeholder="Память передаёт предпочтения основной модели"></textarea></label><button type="button" class="chip-btn" id="brain-add-edge"'+(graph.nodes.length<2?' disabled':'')+'>Добавить связь</button></div>'+
        '<p class="usage-note">Связь можно описать естественным языком; выберите исходный и целевой блоки.</p><label class="brain-wide">Разобрать связи из текста<textarea id="brain-natural-edges" rows="3" maxlength="3000" placeholder="Запрос передаёт данные Памяти&#10;Инструменты возвращают результаты Основной модели"></textarea></label><button type="button" class="chip-btn" id="brain-parse-edges">Разобрать связи из текста</button></details>'+
        '<div id="brain-save-status" class="brain-save-status" role="status">Сохранено</div>';
      $('#brain-add-node',root).addEventListener('click',async()=>{
        const title=$('#brain-node-title',root).value.trim();if(!title){toast('Укажите название блока');return;}if(graph.nodes.length>=50){toast('Максимум 50 блоков');return;}
        graph.nodes.push({id:'node_'+Math.random().toString(36).slice(2,10),title:title.slice(0,100),kind:($('#brain-node-kind',root).value||'Блок').trim().slice(0,40),description:$('#brain-node-description',root).value.trim().slice(0,600)});
        render();await save();
      });
      $('#brain-add-edge',root).addEventListener('click',async()=>{
        const from=$('#brain-edge-from',root).value,to=$('#brain-edge-to',root).value,relation=$('#brain-edge-relation',root).value.trim();
        if(!from||!to||from===to){toast('Выберите два разных блока');return;}if(!relation){toast('Опишите связь');return;}if(graph.edges.length>=120){toast('Максимум 120 связей');return;}
        graph.edges.push({id:'edge_'+Math.random().toString(36).slice(2,10),from,to,relation:relation.slice(0,600)});render();await save();
      });
      $$('[data-brain-delete-node]',root).forEach(b=>b.addEventListener('click',async()=>{
        const id=b.dataset.brainDeleteNode;graph.nodes=graph.nodes.filter(n=>n.id!==id);graph.edges=graph.edges.filter(e=>e.from!==id&&e.to!==id);render();await save();
      }));
      $$('[data-brain-delete-edge]',root).forEach(b=>b.addEventListener('click',async()=>{
        graph.edges=graph.edges.filter(e=>e.id!==b.dataset.brainDeleteEdge);render();await save();
      }));
      $('#brain-parse-edges',root).addEventListener('click',async()=>{
        const lines=$('#brain-natural-edges',root).value.split(/[\n;]+/).map(x=>x.trim()).filter(Boolean);if(!lines.length){toast('Введите связи — по одной на строку');return;}
        let added=0;
        for(const line of lines){
          const normalizeText=value=>String(value||'').toLocaleLowerCase().replace(/ё/g,'е');
          const tokenize=value=>[...normalizeText(value).matchAll(/[a-zа-я0-9]+/gi)].map(m=>({word:m[0],at:m.index}));
          const textTokens=tokenize(line), normalizedLine=normalizeText(line);
          const found=graph.nodes.map(node=>{
            const title=normalizeText(node.title||'');
            const direct=normalizedLine.indexOf(title);
            if(title&&direct>=0)return {n:node,at:direct,score:100+title.length};
            const wanted=tokenize(title).map(x=>x.word.length>4?x.word.slice(0,5):x.word);
            if(!wanted.length)return null;
            let cursor=-1,firstAt=-1;
            for(const root of wanted){
              const index=textTokens.findIndex((token,i)=>i>cursor&&(token.word.startsWith(root)||root.startsWith(token.word)));
              if(index<0)return null;
              if(firstAt<0)firstAt=textTokens[index].at;
              cursor=index;
            }
            return {n:node,at:firstAt,score:wanted.join('').length};
          }).filter(Boolean).sort((a,b)=>a.at-b.at||b.score-a.score);
          const distinct=[];for(const x of found)if(!distinct.some(y=>y.n.id===x.n.id))distinct.push(x);
          if(distinct.length<2||graph.edges.length>=120)continue;
          const from=distinct[0].n,to=distinct[1].n;if(graph.edges.some(e=>e.from===from.id&&e.to===to.id&&e.relation===line))continue;
          graph.edges.push({id:'edge_'+Math.random().toString(36).slice(2,10),from:from.id,to:to.id,relation:line.slice(0,600)});added++;
        }
        if(!added){toast('Не распознаны два названия блоков. Используйте точные названия из схемы.');return;}render();await save();toast('Добавлено связей: '+added);
      });
    }
    render();
    $('#brain-personal-search',root)?.addEventListener('input',()=>render());
    // On first opening, persist the default template if the account graph was empty.
    await save();
  }


  async function openBrainAdminSettings() {
    const root=$('#modal-root');
    const starter=()=>({version:1,nodes:[
      {id:'input',title:'Запрос',kind:'Вход',description:'Текст вопроса и прикреплённые файлы'},
      {id:'memory',title:'Память',kind:'Контекст',description:'Сохранённые факты и предпочтения'},
      {id:'model',title:'Основная модель',kind:'ИИ',description:'Обрабатывает вопрос и строит ответ'},
      {id:'tools',title:'Инструменты',kind:'Действия',description:'Поиск, код, файлы и коннекторы'},
      {id:'check',title:'Проверка результата',kind:'Контроль',description:'Проверяет полноту и формат'},
      {id:'output',title:'Ответ',kind:'Результат',description:'Текст, интерактивные блоки и файлы'}],
      edges:[
      {id:'e1',from:'input',to:'memory',relation:'По запросу подбирается подходящий контекст'},
      {id:'e2',from:'memory',to:'model',relation:'Память передаёт факты и предпочтения основной модели'},
      {id:'e3',from:'model',to:'tools',relation:'Модель вызывает нужный инструмент'},
      {id:'e4',from:'tools',to:'model',relation:'Результаты инструмента возвращаются модели'},
      {id:'e5',from:'model',to:'check',relation:'Черновик проверяется на полноту'},
      {id:'e6',from:'check',to:'output',relation:'Проверенный результат показывается пользователю'}]});
    let graph=starter();
    try{const result=await api.get('/api/admin/brain-config');if(result&&result.graph&&Array.isArray(result.graph.nodes)&&result.graph.nodes.length)graph=result.graph;}
    catch(e){toast('Не удалось загрузить Второй мозг: '+e.message,'error');return;}
    graph.nodes=Array.isArray(graph.nodes)?graph.nodes:[];graph.edges=Array.isArray(graph.edges)?graph.edges:[];
    openModal({title:'Админка · связи блоков Второго мозга',okText:'Закрыть',extraClass:'wide second-brain-modal',body:'<div id="brain-graph-editor"></div>',onOk:()=>true});
    let revision=0;
    const esc=x=>escapeHtml(String(x==null?'':x));
    const label=id=>{const node=graph.nodes.find(n=>n.id===id);return node?node.title:'Неизвестный блок';};
    async function save(){
      const current=++revision, status=$('#brain-save-status',root);if(status)status.textContent='Сохранение…';
      try{await api.put('/api/admin/brain-config',{graph});if(current===revision&&$('#brain-save-status',root))$('#brain-save-status',root).textContent='Сохранено';}
      catch(err){if($('#brain-save-status',root))$('#brain-save-status',root).textContent='Ошибка сохранения';toast('Не удалось сохранить схему: '+err.message,'error');}
    }
    function render(){
      const nodes=graph.nodes.map(n=>'<article class="brain-node"><div class="brain-node-head"><span>'+esc(n.kind||'Блок')+'</span><button type="button" data-brain-delete-node="'+esc(n.id)+'" title="Удалить блок">×</button></div><h4>'+esc(n.title)+'</h4><p>'+esc(n.description||'')+'</p></article>').join('');
      const options=graph.nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.title)+'</option>').join('');
      const edges=graph.edges.map(e=>'<div class="brain-edge"><div class="brain-edge-route"><b>'+esc(label(e.from))+'</b><span>→</span><b>'+esc(label(e.to))+'</b><button type="button" data-brain-delete-edge="'+esc(e.id)+'" aria-label="Удалить связь">×</button></div><p>'+esc(e.relation||'Без описания')+'</p></div>').join('');
      $('#brain-graph-editor',root).innerHTML='<p class="usage-note">Блок — узел системы. Связь описывает, что именно передаётся между узлами. Изменения хранятся в аккаунте.</p>'+
        '<div class="brain-graph-canvas">'+(nodes||'<p>Нет блоков.</p>')+'</div><h4 class="sec">Связи</h4><div class="brain-edges">'+(edges||'<p class="usage-note">Нет связей.</p>')+'</div>'+
        '<details class="brain-add-details" open><summary>Добавить блок</summary><div class="brain-add-grid"><label>Название<input id="brain-node-title" maxlength="100" placeholder="Например, Проверка фактов"></label><label>Тип<input id="brain-node-kind" maxlength="40" placeholder="Например, Инструмент"></label>'+
        '<label class="brain-wide">Что делает блок<textarea id="brain-node-description" rows="2" maxlength="600" placeholder="Назначение блока обычным языком"></textarea></label><button type="button" class="chip-btn" id="brain-add-node">Добавить блок</button></div></details>'+
        '<details class="brain-add-details" open><summary>Добавить связь</summary><div class="brain-add-grid"><label>Откуда<select id="brain-edge-from">'+options+'</select></label><label>Куда<select id="brain-edge-to">'+options+'</select></label>'+
        '<label class="brain-wide">Как связаны<textarea id="brain-edge-relation" rows="2" maxlength="600" placeholder="Память передаёт предпочтения основной модели"></textarea></label><button type="button" class="chip-btn" id="brain-add-edge"'+(graph.nodes.length<2?' disabled':'')+'>Добавить связь</button></div>'+
        '<p class="usage-note">Связь можно описать естественным языком; выберите исходный и целевой блоки.</p><label class="brain-wide">Разобрать связи из текста<textarea id="brain-natural-edges" rows="3" maxlength="3000" placeholder="Запрос передаёт данные Памяти&#10;Инструменты возвращают результаты Основной модели"></textarea></label><button type="button" class="chip-btn" id="brain-parse-edges">Разобрать связи из текста</button></details>'+
        '<div id="brain-save-status" class="brain-save-status" role="status">Сохранено</div>';
      $('#brain-add-node',root).addEventListener('click',async()=>{
        const title=$('#brain-node-title',root).value.trim();if(!title){toast('Укажите название блока');return;}if(graph.nodes.length>=50){toast('Максимум 50 блоков');return;}
        graph.nodes.push({id:'node_'+Math.random().toString(36).slice(2,10),title:title.slice(0,100),kind:($('#brain-node-kind',root).value||'Блок').trim().slice(0,40),description:$('#brain-node-description',root).value.trim().slice(0,600)});
        render();await save();
      });
      $('#brain-add-edge',root).addEventListener('click',async()=>{
        const from=$('#brain-edge-from',root).value,to=$('#brain-edge-to',root).value,relation=$('#brain-edge-relation',root).value.trim();
        if(!from||!to||from===to){toast('Выберите два разных блока');return;}if(!relation){toast('Опишите связь');return;}if(graph.edges.length>=120){toast('Максимум 120 связей');return;}
        graph.edges.push({id:'edge_'+Math.random().toString(36).slice(2,10),from,to,relation:relation.slice(0,600)});render();await save();
      });
      $$('[data-brain-delete-node]',root).forEach(b=>b.addEventListener('click',async()=>{
        const id=b.dataset.brainDeleteNode;graph.nodes=graph.nodes.filter(n=>n.id!==id);graph.edges=graph.edges.filter(e=>e.from!==id&&e.to!==id);render();await save();
      }));
      $$('[data-brain-delete-edge]',root).forEach(b=>b.addEventListener('click',async()=>{
        graph.edges=graph.edges.filter(e=>e.id!==b.dataset.brainDeleteEdge);render();await save();
      }));
      $('#brain-parse-edges',root).addEventListener('click',async()=>{
        const lines=$('#brain-natural-edges',root).value.split(/[\n;]+/).map(x=>x.trim()).filter(Boolean);if(!lines.length){toast('Введите связи — по одной на строку');return;}
        let added=0;
        for(const line of lines){
          const normalizeText=value=>String(value||'').toLocaleLowerCase().replace(/ё/g,'е');
          const tokenize=value=>[...normalizeText(value).matchAll(/[a-zа-я0-9]+/gi)].map(m=>({word:m[0],at:m.index}));
          const textTokens=tokenize(line), normalizedLine=normalizeText(line);
          const found=graph.nodes.map(node=>{
            const title=normalizeText(node.title||'');
            const direct=normalizedLine.indexOf(title);
            if(title&&direct>=0)return {n:node,at:direct,score:100+title.length};
            const wanted=tokenize(title).map(x=>x.word.length>4?x.word.slice(0,5):x.word);
            if(!wanted.length)return null;
            let cursor=-1,firstAt=-1;
            for(const root of wanted){
              const index=textTokens.findIndex((token,i)=>i>cursor&&(token.word.startsWith(root)||root.startsWith(token.word)));
              if(index<0)return null;
              if(firstAt<0)firstAt=textTokens[index].at;
              cursor=index;
            }
            return {n:node,at:firstAt,score:wanted.join('').length};
          }).filter(Boolean).sort((a,b)=>a.at-b.at||b.score-a.score);
          const distinct=[];for(const x of found)if(!distinct.some(y=>y.n.id===x.n.id))distinct.push(x);
          if(distinct.length<2||graph.edges.length>=120)continue;
          const from=distinct[0].n,to=distinct[1].n;if(graph.edges.some(e=>e.from===from.id&&e.to===to.id&&e.relation===line))continue;
          graph.edges.push({id:'edge_'+Math.random().toString(36).slice(2,10),from:from.id,to:to.id,relation:line.slice(0,600)});added++;
        }
        if(!added){toast('Не распознаны два названия блоков. Используйте точные названия из схемы.');return;}render();await save();toast('Добавлено связей: '+added);
      });
    }
    render();
    // On first opening, persist the default template if the account graph was empty.
    await save();
  }

  function modelSetRequiresPro(set) {
    if (!set || typeof set !== 'object') return false;
    if (typeof set.requires_pro === 'boolean') return set.requires_pro;
    if (typeof set.free_access === 'boolean') return !set.free_access;
    return set.free_access === 0 || String(set.free_access).toLowerCase() === 'false';
  }

  function modelSetCanUse(set) {
    return !!(set && (!modelSetRequiresPro(set) || (state.user && (state.user.is_admin || state.user.plan === 'pro'))));
  }

  function renderModelPicker() {
    const button = $('#model-select-btn'), panel = $('#model-picker');
    if (!panel) return;
    let selected = state.modelSets.find(s => s.id === state.modelSetId && modelSetCanUse(s));
    if (!selected) {
      selected = state.modelSets.find(modelSetCanUse) || null; state.modelSetId = selected ? selected.id : '';
      if (selected) localStorage.setItem('aich_model_set_id', selected.id); else localStorage.removeItem('aich_model_set_id');
    }
    if (button) {
      button.innerHTML = '<span class="model-select-label">' + escapeHtml(selected ? selected.name : 'Нет доступных моделей') + '</span>' +
        (selected && modelSetRequiresPro(selected) ? '<span class="model-pro-badge model-select-pro-badge">Доступно на Pro</span>' : '') +
        icon('chevron-down');
      button.title = selected ? ((modelSetRequiresPro(selected) ? 'Доступно на Pro · ' : '') + (selected.description || selected.name)) : 'Нет активных моделей';
      button.style.width = 'max-content'; button.style.maxWidth = 'min(44vw,260px)';
      button.setAttribute('aria-expanded', String(!!state.modelPickerOpen));
    }
    const isOpen = !!state.modelPickerOpen && addChatActiveView === 'model';
    panel.classList.toggle('hidden', !isOpen);
    if (!isOpen) { panel.innerHTML = ''; return; }
    if (!state.modelSets.length) { panel.innerHTML = '<div class="model-picker-empty">Нет активных кластеров моделей.</div>'; return; }
    panel.innerHTML = state.modelSets.map((set, modelIndex) => {
      const requiresPro = modelSetRequiresPro(set);
      const locked = !modelSetCanUse(set);
      const entry = (set.entries || []).find(e => e && e.is_active) || (set.entries || [])[0];
      const isSelected = !!(selected && selected.id === set.id);
      const description = String(set.description || '').trim() || 'Универсальные задачи';
      const context = entry && Number(entry.context_len) > 0 ? 'Контекст ' + fmtNum(entry.context_len) : '';
      return '<button type="button" role="option" aria-selected="' + String(isSelected) + '" aria-disabled="' + String(locked) + '" class="model-option' + (isSelected ? ' selected' : '') + (locked ? ' locked' : '') + '" data-model-index="' + modelIndex + '">' +
        '<span class="model-option-head"><b>' + escapeHtml(set.name) + '</b>' +
        (requiresPro ? '<span class="model-pro-badge">Доступно на Pro</span>' : '') +
        (isSelected ? '<span class="model-option-check">' + icon('check') + '</span>' : '') + '</span>' +
        '<span class="model-option-desc">' + escapeHtml(description) + '</span>' +
        (context ? '<span class="model-option-meta">' + escapeHtml(context) + '</span>' : '') + '</button>';
    }).join('');
  }

  async function loadModelSets() {
    try { state.modelSets = await api.get('/api/models/sets'); if (!Array.isArray(state.modelSets)) state.modelSets = []; }
    catch (e) { state.modelSets = []; }
    const globalDefault = state.modelSets.find(s => s.is_default) || null;
    const globalDefaultId = globalDefault ? globalDefault.id : '';
    const lastKnownDefaultId = localStorage.getItem('aich_default_model_set_id') || '';
    const globalDefaultChanged = globalDefaultId !== lastKnownDefaultId;
    if (globalDefaultId) localStorage.setItem('aich_default_model_set_id', globalDefaultId);
    else localStorage.removeItem('aich_default_model_set_id');

    const saved = localStorage.getItem('aich_model_set_id') || state.modelSetId;
    const selected = state.modelSets.find(s => s.id === saved && modelSetCanUse(s));
    const availableDefault = globalDefault && modelSetCanUse(globalDefault) ? globalDefault : null;
    const firstAllowed = state.modelSets.find(modelSetCanUse);
    state.modelSetId = (
      (globalDefaultChanged && availableDefault) || selected || availableDefault || firstAllowed || {}
    ).id || '';
    if (state.modelSetId) localStorage.setItem('aich_model_set_id', state.modelSetId);
    else localStorage.removeItem('aich_model_set_id');
    renderModelPicker();
  }

  // ---------- files ----------
  const workspaceFileFilters = { query: '', source: 'all', kind: 'all', sort: 'date-desc' };

  async function loadFiles() {
    state.files = await api.get('/api/files');
    renderFiles();
    renderFilesWorkspace();
  }

  function workspaceFileKind(file) {
    const name = String(file && file.original_name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    const kind = String(file && file.kind || '').toLowerCase();
    if (kind === 'image' || ['svg','png','jpg','jpeg','webp','gif','bmp','avif'].includes(ext)) return 'image';
    if (['ppt','pptx','odp','key'].includes(ext) || ['slide','presentation'].includes(kind)) return 'slide';
    if (['csv','tsv','xls','xlsx','ods'].includes(ext) || ['sheet','table','csv','xlsx'].includes(kind)) return 'table';
    if (['py','js','ts','jsx','tsx','html','css','json','sql','sh','bash','ipynb','rs','java','c','cpp','h','go','php','rb'].includes(ext) || ['code','text'].includes(kind)) return 'code';
    if (['pdf','doc','docx','odt','rtf','txt','md','epub','xml'].includes(ext) || ['pdf','doc','docx','text'].includes(kind)) return 'doc';
    return 'other';
  }

  function workspaceFileKindLabel(kind) {
    return ({ image: 'Изображение', doc: 'Документ', table: 'Таблица', slide: 'Презентация', code: 'Код', other: 'Файл' })[kind] || 'Файл';
  }

  function renderFilesWorkspace() {
    const box = $('#workspace-files-list');
    if (!box) return;
    const sourceItems = Array.isArray(state.files) ? state.files : [];
    const filters = workspaceFileFilters;
    const query = String(filters.query || '').trim().toLocaleLowerCase();
    let items = sourceItems.filter(file => {
      if (!file || !file.id) return false;
      if (query && !String(file.original_name || '').toLocaleLowerCase().includes(query)) return false;
      const source = file.source === 'ai' ? 'ai' : 'user';
      if (filters.source !== 'all' && filters.source !== source) return false;
      if (filters.kind !== 'all' && workspaceFileKind(file) !== filters.kind) return false;
      return true;
    });
    const nameCmp = (a, b) => String(a.original_name || '').localeCompare(String(b.original_name || ''), 'ru', { sensitivity: 'base' });
    items.sort((a, b) => {
      if (filters.sort === 'name-asc') return nameCmp(a, b);
      if (filters.sort === 'name-desc') return nameCmp(b, a);
      if (filters.sort === 'size-desc') return (Number(b.size) || 0) - (Number(a.size) || 0);
      if (filters.sort === 'size-asc') return (Number(a.size) || 0) - (Number(b.size) || 0);
      if (filters.sort === 'type') return workspaceFileKind(a).localeCompare(workspaceFileKind(b)) || nameCmp(a, b);
      const dateA = Date.parse(a.created_at || '') || 0;
      const dateB = Date.parse(b.created_at || '') || 0;
      return filters.sort === 'date-asc' ? dateA - dateB : dateB - dateA;
    });
    const summary = $('#workspace-files-summary');
    if (summary) summary.textContent = items.length + (items.length === 1 ? ' файл' : ' файлов');
    if (!items.length) {
      box.innerHTML = '<div class="files-workspace-empty"><span class="files-empty-art">' + icon('folder') +
        '</span><strong>' + (sourceItems.length ? 'Ничего не найдено' : 'Файлов пока нет') +
        '</strong><p>' + (sourceItems.length ? 'Измените фильтры или поисковый запрос.' : 'Загружайте файлы или попросите AI CH создать документ.') +
        '</p></div>';
      return;
    }
    box.innerHTML = items.map(file => {
      const id = encodeURIComponent(String(file.id));
      const name = String(file.original_name || 'Файл');
      const kind = workspaceFileKind(file);
      const source = file.source === 'ai' ? 'ai' : 'user';
      const created = file.created_at ? new Date(file.created_at) : null;
      const date = created && Number.isFinite(created.getTime()) ? created.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      const fileMime = String(file.mime_type || '').toLowerCase();
      const isSvg = /\.svg$/i.test(name) || fileMime === 'image/svg+xml';
      const isImage = kind === 'image';
      const previewUrl = isSvg
        ? '/api/files/' + id + '/download?inline=1'
        : '/api/files/' + id + '/thumbnail';
      const image = isImage
        ? '<img class="workspace-file-image" src="' + previewUrl + '" alt="' + escapeHtml(name) +
          '" loading="lazy" decoding="async" />'
        : '<span class="workspace-file-glyph">' + icon(kind === 'slide' ? 'file-text' : kind === 'table' ? 'table' : kind === 'code' ? 'code' : kind === 'doc' ? 'file-text' : 'file') + '</span>';
      return '<article class="workspace-file-card">' +
        '<a class="workspace-file-preview' + (isImage ? ' is-image' : '') + '" href="/api/files/' + id + '/download" ' +
          (isImage ? 'target="_blank" rel="noopener noreferrer" ' : 'download ') + 'aria-label="Открыть ' + escapeHtml(name) + '">' + image + '</a>' +
        '<div class="workspace-file-info"><div class="workspace-file-labels"><span class="workspace-source-badge ' + source + '">' +
          (source === 'ai' ? 'AI CH' : 'Вы') + '</span><span class="workspace-file-kind">' + workspaceFileKindLabel(kind) + '</span></div>' +
        '<strong class="workspace-file-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</strong>' +
        '<div class="workspace-file-meta"><span>' + escapeHtml(date) + '</span><span>' + formatSize(Number(file.size) || 0) + '</span></div>' +
        '<div class="workspace-file-actions"><button type="button" class="chip-btn workspace-file-attach" data-workspace-file-attach="' + escapeHtml(String(file.id)) + '">' + icon('plus') + 'В чат</button><a class="chip-btn workspace-file-download" href="/api/files/' + id + '/download" download="' + escapeHtml(name) + '">' +
        icon('download') + 'Скачать</a><button type="button" class="icon-btn workspace-file-delete" data-workspace-file-delete="' + escapeHtml(String(file.id)) + '" title="Удалить файл" aria-label="Удалить файл">' + icon('trash') + '</button></div></div></article>';
    }).join('');
  }

  async function openFilesWorkspace() {
    const shell = $('#files-workspace-shell');
    if (!shell) return;
    toggleFiles(false);
    try {
      await loadFiles();
      shell.classList.remove('hidden');
      shell.classList.add('open');
      shell.setAttribute('aria-hidden', 'false');
      document.body.classList.add('files-workspace-open');
      requestAnimationFrame(() => $('.files-workspace', shell)?.focus());
    } catch (error) {
      toast('Не удалось открыть файлы: ' + error.message, 'error');
    }
  }

  function closeFilesWorkspace() {
    const shell = $('#files-workspace-shell');
    if (!shell) return;
    shell.classList.remove('open');
    shell.classList.add('hidden');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('files-workspace-open');
  }

  let workspaceProjectsData = [];
  let workspaceProjectChats = [];
  let projectWorkspaceActiveId = null;
  let projectWorkspaceEditor = null;

  async function loadUserProjects() {
    workspaceProjectsData = await api.get('/api/projects');
    workspaceProjectsData = Array.isArray(workspaceProjectsData) ? workspaceProjectsData : [];
    return workspaceProjectsData;
  }

  async function loadWorkspaceProjectChats() {
    const chats = await api.get('/api/chats');
    workspaceProjectChats = Array.isArray(chats) ? chats.filter(chat => chat && chat.id) : [];
    return workspaceProjectChats;
  }

  async function openProjectsWorkspace() {
    try {
      await Promise.all([loadUserProjects(), loadWorkspaceProjectChats()]);
      const shell = $('#projects-workspace-shell');
      shell.classList.remove('hidden');
      shell.classList.add('open');
      shell.setAttribute('aria-hidden', 'false');
      document.body.classList.add('files-workspace-open');
      renderProjectsWorkspace();
      requestAnimationFrame(() => $('.projects-workspace', shell)?.focus());
    } catch (error) {
      toast('Не удалось загрузить проекты: ' + error.message, 'error');
    }
  }

  function closeProjectsWorkspace() {
    const shell = $('#projects-workspace-shell');
    if (!shell) return;
    shell.classList.remove('open');
    shell.classList.add('hidden');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('files-workspace-open');
  }

  function renderProjectsWorkspace() {
    const box = $('#workspace-projects-list');
    if (!box) return;
    if (projectWorkspaceEditor) {
      const edit = projectWorkspaceEditor;
      box.innerHTML = '<div class="workspace-editor-card"><button type="button" class="chip-btn" data-project-action="cancel-edit">' +
        icon('chevron-down') + ' Назад</button><form id="workspace-project-form" class="workspace-project-form">' +
        '<h3>' + (edit.id ? 'Настроить проект' : 'Новый проект') + '</h3>' +
        '<label for="workspace-project-name">Название</label><input id="workspace-project-name" maxlength="120" required value="' +
        escapeHtml(edit.title || '') + '" placeholder="Например, подготовка к ЕГЭ" />' +
        '<label for="workspace-project-description">Описание и заметки</label><textarea id="workspace-project-description" maxlength="5000" rows="5" placeholder="Цели, ссылки, требования и другая информация">' +
        escapeHtml(edit.description || '') + '</textarea>' +
        '<div class="workspace-editor-actions"><button type="button" class="ghost" data-project-action="cancel-edit">Отмена</button>' +
        '<button type="button" class="solid" data-project-action="save">Сохранить проект</button></div></form></div>';
      return;
    }
    const active = projectWorkspaceActiveId
      ? workspaceProjectsData.find(item => String(item.id) === String(projectWorkspaceActiveId))
      : null;
    if (active) {
      const chats = workspaceProjectChats.filter(chat =>
        chat && String(chat.project_id || '') === String(active.id));
      box.innerHTML = '<div class="workspace-project-detail">' +
        '<button type="button" class="chip-btn" data-project-action="back">' + icon('chevron-down') + ' Все проекты</button>' +
        '<section class="workspace-project-hero"><div class="workspace-project-icon">' + icon('folder') + '</div>' +
        '<div class="workspace-project-copy"><h3>' + escapeHtml(active.title || 'Без названия') + '</h3>' +
        '<p>' + escapeHtml(active.description || 'Пока нет описания. Добавьте цели и заметки проекта.') + '</p></div>' +
        '<div class="workspace-project-actions"><button type="button" class="chip-btn" data-project-action="edit" data-project-id="' + escapeHtml(active.id) + '">' + icon('pencil') + ' Изменить</button>' +
        '<button type="button" class="chip-btn" data-project-action="delete" data-project-id="' + escapeHtml(active.id) + '">' + icon('trash') + ' Удалить</button></div></section>' +
        '<section class="workspace-project-chats"><div class="workspace-project-section-head"><h3>Чаты проекта</h3>' +
        '<span class="skills-count">' + chats.length + '</span></div>' +
        (chats.length ? '<div class="workspace-project-chat-list">' + chats.map(chat =>
          '<button type="button" class="workspace-project-chat" data-open-project-chat="' + escapeHtml(chat.id) + '">' +
          '<span class="workspace-project-chat-icon">' + icon('chat') + '</span><span>' +
          escapeHtml(chat.title || 'Новый чат') + '</span><span class="workspace-project-chat-arrow">' + icon('chevron-down') + '</span></button>'
        ).join('') + '</div>' : '<div class="files-workspace-empty project-no-chats"><span class="files-empty-art">' + icon('chat') +
          '</span><strong>В проекте пока нет чатов</strong><p>Добавьте открытый чат через меню «Поделиться».</p></div>') +
        '<button type="button" class="chip-btn workspace-project-add-current" data-project-action="add-current-chat" ' +
        (!state.currentChatId || String(workspaceProjectChats.find(chat => chat.id === state.currentChatId)?.project_id || '') === String(active.id) ? 'disabled' : '') +
        '>' + icon('plus') + (state.currentChatId ? 'Добавить открытый чат в проект' : 'Сначала откройте чат') + '</button>' +
        '</section></div>';
      return;
    }
    if (!workspaceProjectsData.length) {
      box.innerHTML = '<div class="files-workspace-empty"><span class="files-empty-art">' + icon('folder') +
        '</span><strong>Пока нет проектов</strong><p>Создайте проект, чтобы объединить связанные чаты и сохранить описание.</p>' +
        '<button type="button" class="chip-btn" data-project-action="create">' + icon('plus') + ' Создать проект</button></div>';
      return;
    }
    box.innerHTML = '<div class="workspace-project-grid">' + workspaceProjectsData.map(project =>
      '<article class="workspace-project-card"><button type="button" class="workspace-project-open" data-project-action="open" data-project-id="' +
      escapeHtml(project.id) + '"><span class="workspace-project-card-icon">' + icon('folder') + '</span><strong>' +
      escapeHtml(project.title || 'Без названия') + '</strong><p>' + escapeHtml(project.description || 'Без описания') +
      '</p><span class="workspace-project-card-count">' + Number(project.chat_count || 0) +
      (Number(project.chat_count || 0) === 1 ? ' чат' : ' чатов') + '</span></button>' +
      '<div class="workspace-project-card-actions"><button type="button" class="chip-btn" data-project-action="edit" data-project-id="' +
      escapeHtml(project.id) + '">' + icon('pencil') + ' Изменить</button><button type="button" class="icon-btn" data-project-action="delete" data-project-id="' +
      escapeHtml(project.id) + '" title="Удалить проект">' + icon('trash') + '</button></div></article>'
    ).join('') + '</div><button type="button" class="chip-btn workspace-project-create-inline" data-project-action="create">' +
    icon('plus') + ' Создать проект</button>';
  }

  async function saveProjectEditor() {
    const title = String($('#workspace-project-name')?.value || '').trim();
    const description = String($('#workspace-project-description')?.value || '').trim();
    if (!title) { toast('Укажите название проекта', 'error'); return; }
    const payload = { title, description };
    const editor = projectWorkspaceEditor;
    try {
      const saved = editor && editor.id
        ? await api.patch('/api/projects/' + encodeURIComponent(editor.id), payload)
        : await api.post('/api/projects', payload);
      await Promise.all([loadUserProjects(), loadWorkspaceProjectChats(), loadChats()]);
      projectWorkspaceEditor = null;
      projectWorkspaceActiveId = saved.id;
      renderProjectsWorkspace();
      toast(editor && editor.id ? 'Проект сохранён' : 'Проект создан');
    } catch (error) {
      toast('Не удалось сохранить проект: ' + error.message, 'error');
    }
  }

  function bindProjectsWorkspace() {
    $('#projects-quick-btn')?.addEventListener('click', openProjectsWorkspace);
    $$('[data-projects-workspace-close]').forEach(button => button.addEventListener('click', closeProjectsWorkspace));
    $('#workspace-project-create')?.addEventListener('click', () => {
      projectWorkspaceActiveId = null;
      projectWorkspaceEditor = { id: '', title: '', description: '' };
      renderProjectsWorkspace();
      $('#workspace-project-name')?.focus();
    });
    $('#workspace-projects-list')?.addEventListener('click', async event => {
      const chatButton = event.target.closest('[data-open-project-chat]');
      if (chatButton) {
        const id = String(chatButton.dataset.openProjectChat || '');
        closeProjectsWorkspace();
        await openChat(id);
        return;
      }
      const button = event.target.closest('[data-project-action]');
      if (!button) return;
      const action = button.dataset.projectAction;
      const id = String(button.dataset.projectId || '');
      const project = workspaceProjectsData.find(item => String(item.id) === id);
      if (action === 'create') {
        projectWorkspaceActiveId = null;
        projectWorkspaceEditor = { id: '', title: '', description: '' };
        renderProjectsWorkspace();
        $('#workspace-project-name')?.focus();
      } else if (action === 'cancel-edit') {
        projectWorkspaceEditor = null;
        renderProjectsWorkspace();
      } else if (action === 'open') {
        projectWorkspaceActiveId = id;
        projectWorkspaceEditor = null;
        renderProjectsWorkspace();
      } else if (action === 'edit' && project) {
        projectWorkspaceActiveId = id;
        projectWorkspaceEditor = { id: project.id, title: project.title || '', description: project.description || '' };
        renderProjectsWorkspace();
        $('#workspace-project-name')?.focus();
      } else if (action === 'save') {
        await saveProjectEditor();
      } else if (action === 'back') {
        projectWorkspaceActiveId = null;
        projectWorkspaceEditor = null;
        renderProjectsWorkspace();
      } else if (action === 'delete' && project) {
        if (!confirm('Удалить проект «' + project.title + '»? Его чаты останутся в списке чатов.')) return;
        try {
          await api.del('/api/projects/' + encodeURIComponent(project.id));
          await Promise.all([loadUserProjects(), loadWorkspaceProjectChats(), loadChats()]);
          if (String(projectWorkspaceActiveId || '') === String(project.id)) projectWorkspaceActiveId = null;
          toast('Проект удалён; чаты сохранены');
          renderProjectsWorkspace();
        } catch (error) { toast('Не удалось удалить проект: ' + error.message, 'error'); }
      } else if (action === 'add-current-chat' && project && state.currentChatId) {
        try {
          const updated = await api.patch('/api/chats/' + encodeURIComponent(state.currentChatId), { project_id: project.id });
          const index = (state.chats || []).findIndex(chat => chat.id === updated.id);
          if (index >= 0) state.chats[index] = { ...state.chats[index], ...updated };
          await Promise.all([loadWorkspaceProjectChats(), loadChats()]);
          toast('Чат добавлен в проект «' + project.title + '»');
          renderProjectsWorkspace();
        } catch (error) { toast('Не удалось добавить чат: ' + error.message, 'error'); }
      }
    });
  }

  let scheduledWorkspaceItems = [];
  let scheduledWorkspaceMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let scheduledWorkspaceSelectedDate = scheduleDateKey(new Date());

  function scheduleDateKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(value.getTime())) return '';
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }

  function scheduleLocalDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }

  function scheduleTimeLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';
  }

  async function loadScheduledItems() {
    scheduledWorkspaceItems = await api.get('/api/scheduled');
    scheduledWorkspaceItems = Array.isArray(scheduledWorkspaceItems) ? scheduledWorkspaceItems : [];
    return scheduledWorkspaceItems;
  }

  async function openScheduledWorkspace() {
    try {
      await loadScheduledItems();
      const shell = $('#scheduled-workspace-shell');
      shell.classList.remove('hidden');
      shell.classList.add('open');
      shell.setAttribute('aria-hidden', 'false');
      document.body.classList.add('files-workspace-open');
      renderScheduledWorkspace();
      requestAnimationFrame(() => $('.scheduled-workspace', shell)?.focus());
    } catch (error) {
      toast('Не удалось открыть календарь: ' + error.message, 'error');
    }
  }

  function closeScheduledWorkspace() {
    const shell = $('#scheduled-workspace-shell');
    if (!shell) return;
    shell.classList.remove('open');
    shell.classList.add('hidden');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('files-workspace-open');
  }

  function renderScheduledWorkspace() {
    const grid = $('#schedule-calendar-grid');
    const monthTitle = $('#schedule-month-title');
    const dayLabel = $('#schedule-day-label');
    const dayEvents = $('#schedule-day-events');
    if (!grid || !monthTitle || !dayLabel || !dayEvents) return;
    const year = scheduledWorkspaceMonth.getFullYear();
    const month = scheduledWorkspaceMonth.getMonth();
    monthTitle.textContent = scheduledWorkspaceMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const first = new Date(year, month, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - mondayOffset);
    const counts = new Map();
    scheduledWorkspaceItems.forEach(item => {
      const key = scheduleDateKey(new Date(item.due_at));
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const today = scheduleDateKey(new Date());
    const cells = [];
    for (let index = 0; index < 42; index++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = scheduleDateKey(day);
      const count = counts.get(key) || 0;
      cells.push('<button type="button" class="schedule-day-cell' +
        (day.getMonth() !== month ? ' is-outside' : '') +
        (key === today ? ' is-today' : '') +
        (key === scheduledWorkspaceSelectedDate ? ' is-selected' : '') +
        (count ? ' has-events' : '') + '" data-schedule-date="' + key + '">' +
        '<span class="schedule-day-number">' + day.getDate() + '</span>' +
        (count ? '<span class="schedule-day-count">' + count + '</span>' : '') + '</button>');
    }
    grid.innerHTML = cells.join('');
    let selectedDate = new Date(scheduledWorkspaceSelectedDate + 'T12:00:00');
    if (!Number.isFinite(selectedDate.getTime())) selectedDate = new Date();
    dayLabel.textContent = selectedDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    const items = scheduledWorkspaceItems.filter(item => scheduleDateKey(new Date(item.due_at)) === scheduledWorkspaceSelectedDate)
      .sort((a, b) => (Date.parse(a.due_at) || 0) - (Date.parse(b.due_at) || 0));
    if (!items.length) {
      dayEvents.innerHTML = '<div class="schedule-day-empty"><span>' + icon('calendar') + '</span><strong>Нет записей на этот день</strong><p>Добавьте событие вручную или попросите AI CH внести его в календарь.</p>' +
        '<button type="button" class="chip-btn" data-schedule-action="new">' + icon('plus') + ' Добавить событие</button></div>';
      return;
    }
    dayEvents.innerHTML = items.map(item => {
      const time = scheduleTimeLabel(item.due_at);
      return '<article class="schedule-event-card"><div class="schedule-event-time">' + icon('clock') + '<span>' + escapeHtml(time) + '</span>' +
        '<span class="schedule-event-source ' + (item.created_by === 'ai' ? 'ai' : 'user') + '">' + (item.created_by === 'ai' ? 'AI CH' : 'Вы') + '</span></div>' +
        '<strong>' + escapeHtml(item.title || 'Без названия') + '</strong>' +
        (item.description ? '<p>' + escapeHtml(item.description) + '</p>' : '') +
        '<div class="schedule-event-actions"><button type="button" class="chip-btn" data-schedule-action="edit" data-schedule-id="' + escapeHtml(item.id) + '">' +
        icon('pencil') + 'Изменить</button><button type="button" class="icon-btn" data-schedule-action="delete" data-schedule-id="' + escapeHtml(item.id) + '" title="Удалить событие">' +
        icon('trash') + '</button></div></article>';
    }).join('');
  }

  function openScheduledEditor(itemId) {
    const item = (scheduledWorkspaceItems || []).find(row => String(row.id) === String(itemId));
    const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
    const formDate = item ? scheduleLocalDateTime(item.due_at) : scheduleLocalDateTime(defaultTime);
    const title = item ? item.title || '' : '';
    const description = item ? item.description || '' : '';
    openModal({
      title: item ? 'Изменить событие' : 'Новое событие',
      body: '<div class="schedule-editor-form"><label for="schedule-editor-title">Название</label>' +
        '<input id="schedule-editor-title" maxlength="200" required value="' + escapeHtml(title) + '" placeholder="Например, повторить информатику" />' +
        '<label for="schedule-editor-due">Дата и время</label><input id="schedule-editor-due" type="datetime-local" required value="' + escapeHtml(formDate) + '" />' +
        '<label for="schedule-editor-description">Описание</label><textarea id="schedule-editor-description" rows="4" maxlength="5000" placeholder="Дополнительные детали">' +
        escapeHtml(description) + '</textarea></div>',
      okText: item ? 'Сохранить' : 'Добавить',
      onOk: async root => {
        const titleValue = String($('#schedule-editor-title', root)?.value || '').trim();
        const dueValue = String($('#schedule-editor-due', root)?.value || '');
        const descriptionValue = String($('#schedule-editor-description', root)?.value || '').trim();
        if (!titleValue || !dueValue || !Number.isFinite(new Date(dueValue).getTime())) {
          toast('Укажите название и корректные дату и время', 'error');
          return false;
        }
        const payload = { title: titleValue, description: descriptionValue, due_at: new Date(dueValue).toISOString() };
        try {
          if (item) await api.patch('/api/scheduled/' + encodeURIComponent(item.id), payload);
          else await api.post('/api/scheduled', payload);
          await loadScheduledItems();
          renderScheduledWorkspace();
          toast(item ? 'Запись обновлена' : 'Запись добавлена');
          return true;
        } catch (error) {
          toast('Не удалось сохранить запись: ' + error.message, 'error');
          return false;
        }
      },
    });
  }

  function bindScheduledWorkspace() {
    $('#scheduled-quick-btn')?.addEventListener('click', openScheduledWorkspace);
    $$('[data-scheduled-workspace-close]').forEach(button => button.addEventListener('click', closeScheduledWorkspace));
    $('#scheduled-create-btn')?.addEventListener('click', () => openScheduledEditor(''));
    $('#schedule-add-day')?.addEventListener('click', () => openScheduledEditor(''));
    $('#schedule-prev-month')?.addEventListener('click', () => {
      scheduledWorkspaceMonth = new Date(scheduledWorkspaceMonth.getFullYear(), scheduledWorkspaceMonth.getMonth() - 1, 1);
      renderScheduledWorkspace();
    });
    $('#schedule-next-month')?.addEventListener('click', () => {
      scheduledWorkspaceMonth = new Date(scheduledWorkspaceMonth.getFullYear(), scheduledWorkspaceMonth.getMonth() + 1, 1);
      renderScheduledWorkspace();
    });
    $('#schedule-today-btn')?.addEventListener('click', () => {
      scheduledWorkspaceMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      scheduledWorkspaceSelectedDate = scheduleDateKey(new Date());
      renderScheduledWorkspace();
    });
    $('#schedule-calendar-grid')?.addEventListener('click', event => {
      const button = event.target.closest('[data-schedule-date]');
      if (!button) return;
      scheduledWorkspaceSelectedDate = button.dataset.scheduleDate;
      scheduledWorkspaceMonth = new Date(scheduledWorkspaceSelectedDate + 'T12:00:00');
      scheduledWorkspaceMonth = new Date(scheduledWorkspaceMonth.getFullYear(), scheduledWorkspaceMonth.getMonth(), 1);
      renderScheduledWorkspace();
    });
    $('#schedule-day-events')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-schedule-action]');
      if (!button) return;
      const action = button.dataset.scheduleAction;
      const id = String(button.dataset.scheduleId || '');
      const item = scheduledWorkspaceItems.find(row => String(row.id) === id);
      if (action === 'new') return openScheduledEditor('');
      if (action === 'edit' && item) return openScheduledEditor(item.id);
      if (action === 'delete' && item && confirm('Удалить запись «' + item.title + '»?')) {
        try {
          await api.del('/api/scheduled/' + encodeURIComponent(item.id));
          await loadScheduledItems();
          renderScheduledWorkspace();
          toast('Запись удалена');
        } catch (error) { toast('Не удалось удалить запись: ' + error.message, 'error'); }
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if ($('#projects-workspace-shell')?.classList.contains('open')) closeProjectsWorkspace();
        if ($('#scheduled-workspace-shell')?.classList.contains('open')) closeScheduledWorkspace();
      }
    });
  }

  function bindFilesWorkspace() {
    $('#files-quick-btn')?.addEventListener('click', openFilesWorkspace);
    $$('[data-files-workspace-close]').forEach(button => button.addEventListener('click', closeFilesWorkspace));
    $('#workspace-file-upload')?.addEventListener('click', () => {
      workspaceUploadIntent = true;
      $('#file-input')?.click();
    });
    $('#workspace-file-search')?.addEventListener('input', event => {
      workspaceFileFilters.query = event.target.value || '';
      renderFilesWorkspace();
    });
    $('#workspace-file-source')?.addEventListener('change', event => {
      workspaceFileFilters.source = event.target.value || 'all';
      renderFilesWorkspace();
    });
    $('#workspace-file-kind')?.addEventListener('change', event => {
      workspaceFileFilters.kind = event.target.value || 'all';
      renderFilesWorkspace();
    });
    $('#workspace-file-sort')?.addEventListener('change', event => {
      workspaceFileFilters.sort = event.target.value || 'date-desc';
      renderFilesWorkspace();
    });
    $('#workspace-files-list')?.addEventListener('click', async event => {
      const attachButton = event.target.closest('[data-workspace-file-attach]');
      if (attachButton) {
        const id = String(attachButton.dataset.workspaceFileAttach || '');
        const file = (state.files || []).find(item => String(item.id) === id);
        if (!file) { toast('Файл больше недоступен. Обновите библиотеку.', 'error'); return; }
        if (!(state.pendingAttachments || []).some(item => item && String(item.id) === id)) {
          state.pendingAttachments.push(file);
          renderAttachments();
        }
        closeFilesWorkspace();
        toast('Файл добавлен к сообщению');
        return;
      }
      const button = event.target.closest('[data-workspace-file-delete]');
      if (!button) return;
      const id = String(button.dataset.workspaceFileDelete || '');
      const file = (state.files || []).find(item => String(item.id) === id);
      if (!file || !confirm('Удалить файл «' + (file.original_name || 'Файл') + '»?')) return;
      button.disabled = true;
      try {
        await api.del('/api/files/' + encodeURIComponent(id));
        state.files = (state.files || []).filter(item => String(item.id) !== id);
        renderFiles();
        renderFilesWorkspace();
        toast('Файл удалён');
      } catch (error) {
        button.disabled = false;
        toast('Не удалось удалить файл: ' + error.message, 'error');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#files-workspace-shell')?.classList.contains('open')) closeFilesWorkspace();
    });
  }

  function kindIcon() {
    return icon('file');
  }

  function renderFiles() {
    const box = $('#file-list');
    const q = (state.fileQuery || '').toLowerCase();
    const kind = state.fileKind || 'all';
    let items = state.files || [];
    if (q) items = items.filter(f => (f.original_name || '').toLowerCase().includes(q));
    if (kind !== 'all') {
      items = items.filter(f => {
        const k = f.kind || 'other';
        if (kind === 'image') return k === 'image';
        if (kind === 'doc') return ['pdf', 'doc', 'docx', 'txt', 'md', 'code', 'text'].includes(k);
        if (kind === 'table') return ['sheet', 'csv', 'xlsx'].includes(k);
        if (kind === 'slide') return k === 'slide' || k === 'presentation';
        return !['image', 'pdf', 'doc', 'docx', 'txt', 'md', 'code', 'text', 'sheet', 'csv', 'xlsx', 'slide'].includes(k);
      });
    }
    if (!items.length) {
      box.innerHTML = '<div class="side-empty">' +
        (state.files.length ? 'Ничего не найдено' : 'Файлов пока нет') + '</div>';
      return;
    }
    box.innerHTML = items.map(f =>
      '<div class="file-item">' +
        '<span class="fi-kind">' + kindIcon(f.kind) + '</span>' +
        '<span class="fi-name" title="' + escapeHtml(f.original_name) + '">' + escapeHtml(f.original_name) + '</span>' +
        '<span class="fi-size">' + formatSize(f.size) + '</span>' +
        '<a class="fi-btn" href="/api/files/' + f.id + '/download" title="Скачать" download>' +
        icon('download') + '</a>' +
        '<button data-attach="' + f.id + '" title="Прикрепить">' + icon('plus') + '</button>' +
        '<button data-del="' + f.id + '" title="Удалить">' + icon('trash') + '</button>' +
      '</div>').join('');
    $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
      await api.del('/api/files/' + b.dataset.del);
      state.files = state.files.filter(x => x.id !== b.dataset.del);
      renderFiles();
    }));
    $$('[data-attach]', box).forEach(b => b.addEventListener('click', () => {
      const f = state.files.find(x => x.id === b.dataset.attach);
      if (f && !state.pendingAttachments.some(x => x && x.id === f.id)) {
        state.pendingAttachments.push(f);
        renderAttachments();
      }
      toggleFiles(false);
    }));
  }

  async function uploadFiles(files, options) {
    const selectedFiles = Array.from(files || []).filter(file => file instanceof File);
    if (!selectedFiles.length) return;
    const fd = new FormData();
    selectedFiles.forEach(file => fd.append('files', file, file.name));
    try {
      const response = await api.postForm('/api/files', fd);
      const uploaded = Array.isArray(response)
        ? response.filter(file => file && typeof file.id === 'string' && file.id)
        : [];
      if (!uploaded.length) throw new Error('Сервер не подтвердил загрузку файлов');
      const fileMap = new Map();
      uploaded.concat(Array.isArray(state.files) ? state.files : []).forEach(file => {
        if (file && file.id) fileMap.set(String(file.id), file);
      });
      state.files = Array.from(fileMap.values());
      renderFiles();
      renderFilesWorkspace();
      if (!(options && options.libraryOnly)) {
        const attachedMap = new Map((Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [])
          .filter(file => file && file.id).map(file => [String(file.id), file]));
        uploaded.forEach(file => attachedMap.set(String(file.id), file));
        state.pendingAttachments = Array.from(attachedMap.values());
        renderAttachments();
        toast(uploaded.length === 1 ? 'Файл прикреплён к сообщению' : 'Файлы прикреплены к сообщению');
      } else {
        toast(uploaded.length === 1 ? 'Файл загружен в библиотеку' : 'Файлы загружены в библиотеку');
      }
    } catch (err) {
      toast('Ошибка загрузки: ' + usefulErrorMessage(err, 'не удалось загрузить файлы'), 'error');
    }
  }

  function toggleFiles(force) {
    const p = $('#files-panel');
    const show = force === undefined ? p.classList.contains('hidden') : force;
    p.classList.toggle('hidden', !show);
    if (show) loadFiles();
  }

  function bindFiles() {
    $('#mem-quick-btn').addEventListener('click', () => openMemory());
    $('#skills-quick-btn').addEventListener('click', () => openSkills());
    const connectorsButton = $('#connectors-quick-btn');
    if (connectorsButton) connectorsButton.addEventListener('click', () => openConnectors());
    $('#close-files-btn').addEventListener('click', () => toggleFiles(false));
    $('#upload-btn').addEventListener('click', () => { workspaceUploadIntent = false; $('#file-input').click(); });
    $('#file-search').addEventListener('input', (e) => {
      state.fileQuery = e.target.value.trim();
      renderFiles();
    });
    $('#file-filter').addEventListener('change', (e) => {
      state.fileKind = e.target.value;
      renderFiles();
    });
    const dz = $('#drop-zone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) await uploadFiles(files);
    });
  }

  // ---------- modal ----------
  function closeModal() {
    $('#modal-root').innerHTML = '';
  }

  function openModal({ title, body, onOk, okText, extraClass }) {
    const root = $('#modal-root');
    const infoOnly = (okText || '') === 'Закрыть';
    const modalClasses = (infoOnly ? ' wide' : '') + (extraClass ? ' ' + extraClass : '');
    const sheetMode = String(extraClass || '').split(/\s+/).includes('bottom-sheet');
    const backClass = 'modal-back' + (sheetMode ? ' modal-back-sheet' : '');
    const sheetHandle = sheetMode
      ? '<div class="modal-sheet-handle-wrap" aria-hidden="true"><span class="modal-sheet-handle"></span></div>'
      : '';
    const titleHeader = sheetMode
      ? '<div class="modal-sheet-title-row"><h3>' + escapeHtml(title) + '</h3><button type="button" class="modal-sheet-close" data-sheet-close title="Закрыть" aria-label="Закрыть"><svg class="ic"><use href="#i-x"/></svg></button></div>'
      : '<h3>' + escapeHtml(title) + '</h3>';
    root.innerHTML = '<div class="' + backClass + '"><div class="modal' + modalClasses +
      '">' + sheetHandle + titleHeader +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="row">' +
      (infoOnly ? '' : '<button class="ghost" data-cancel>Отмена</button>') +
      '<button class="solid" data-ok>' + escapeHtml(okText || 'Сохранить') + '</button></div></div></div>';
    const back = $('.modal-back', root);
    const close = () => { root.innerHTML = ''; };
    const cancel = $('[data-cancel]', root);
    if (cancel) cancel.addEventListener('click', close);
    const sheetClose = $('[data-sheet-close]', root);
    if (sheetClose) sheetClose.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    $('[data-ok]', root).addEventListener('click', async () => {
      try { const ok = onOk ? await onOk(root) : true; if (ok !== false) close(); }
      catch (err) { toast('Ошибка: ' + err.message, 'error'); }
    });
    const inp = $('input, textarea', root);
    if (inp) { inp.focus(); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('[data-ok]', root).click(); } }); }
  }

  // ---------- admin: model sets ----------

  // live cost estimate for a model: prices are $ per 1M tokens
  function wireCostCalc(root, calcId, ids) {
    const box = $('#' + calcId, root);
    if (!box) return;
    const get = (id) => { const n = $('#' + id, root); return n ? (parseFloat(n.value) || 0) : 0; };
    const upd = () => {
      const pin = get(ids.in), pout = get(ids.out), pcache = get(ids.cache);
      const ctx = get(ids.ctx), mx = get(ids.max);
      const full = (pin * ctx) / 1e6 + (pout * mx) / 1e6;
      const short = (pin * 1000) / 1e6 + (pout * 500) / 1e6;
      box.innerHTML =
        '<div class="calc-line"><span>Вход</span><b>$' + pin + ' / 1M токенов</b></div>' +
        '<div class="calc-line"><span>Выход</span><b>$' + pout + ' / 1M токенов</b></div>' +
        '<div class="calc-line"><span>Кэш</span><b>$' + pcache + ' / 1M токенов</b></div>' +
        '<div class="calc-line total"><span>Короткий ответ (1k контекст + 0.5k ответ)</span><b>≈ $' +
          short.toFixed(5) + '</b></div>' +
        '<div class="calc-line total"><span>Полный контекст ' + fmtNum(ctx) + ' + ответ ' +
          fmtNum(mx) + '</span><b>≈ $' + full.toFixed(4) + '</b></div>' +
        (pout ? '<div class="calc-line"><span>1000 таких ответов</span><b>≈ $' +
          (full * 1000).toFixed(2) + '</b></div>' : '');
    };
    $$('input', root).forEach(i => {
      i.addEventListener('input', upd);
      i.addEventListener('change', upd);
    });
    upd();
  }

  function adminForm(root, title, fields, onSubmit, done) {
    root.innerHTML = '<div class="modal-back"><div class="modal wide"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body lim-plans">' + fields.map(f =>
        f.type === 'html' ? (f.html || '') :
        '<label>' + escapeHtml(f.label) +
        (f.type === 'select'
          ? '<select id="' + f.id + '">' + f.options.map(o => '<option' + (f.selected === o ? ' selected' : '') + '>' + escapeHtml(o) + '</option>').join('') + '</select>'
          : f.type === 'textarea'
            ? '<textarea id="' + f.id + '" rows="3"' + (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') + '>' + escapeHtml(f.value || '') + '</textarea>'
            : '<input id="' + f.id + '" type="' + (f.type || 'text') + '"' +
              (f.type === 'number' ? ' step="any"' : '') +
              (f.value !== undefined ? ' value="' + escapeHtml(f.value) + '"' : '') +
              (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') +
              (f.calc ? ' data-calc="1" inputmode="decimal"' : '') + ' />') +
        (f.note ? '<span class="field-note">' + f.note + '</span>' : '') +
        '</label>').join('') + '</div>' +
      '<div class="row"><button class="ghost" data-cancel>Отмена</button>' +
      '<button class="solid" data-ok>Сохранить</button></div></div></div>';
    $('[data-cancel]', root).addEventListener('click', done);
    $('[data-ok]', root).addEventListener('click', async () => {
      try { await onSubmit(); done(); } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
  }

  async function openModelSetsAdmin() {
    const root = $('#modal-root');
    async function rerender() {
      const sets = (await api.get('/api/admin/model-sets')).filter(s => s.route_type === 'MAIN' && !s.is_router);
      const statusConfig = await api.get('/api/admin/status-model');
      const readableConfig = await api.get('/api/admin/readable-text-model');
      function auxCard(prefix, title, description, config, temp) {
        const field = (name, label, value, type='text', placeholder='') =>
          '<label><span>' + label + '</span><input id="' + prefix + '-' + name + '" type="' + type + '" value="' +
          (type === 'password' ? '' : escapeHtml(String(value ?? ''))) + '" placeholder="' +
          escapeHtml(placeholder || (type === 'password' && config.has_api_key ? 'Ключ сохранён — пустое поле не изменит его' : '')) +
          '" autocomplete="' + (type === 'password' ? 'new-password' : 'off') + '"></label>';
        const usage = config.usage || {};
        const usageLine = '<p class="aux-usage">Использование: ' +
          Number(usage.calls || 0).toLocaleString('ru-RU') + ' вызовов · вход ' +
          Number(usage.tokens_in || 0).toLocaleString('ru-RU') + ' / выход ' +
          Number(usage.tokens_out || 0).toLocaleString('ru-RU') + ' токенов · $' +
          Number(usage.cost_usd || 0).toFixed(6) + '</p>';
        return '<section class="aux-model-card"><header><div><b>' + title + '</b><p>' + description + '</p></div>' +
          (temp ? '<span class="aux-temperature">Temperature 1.1</span>' : '') + '</header><div class="aux-model-fields">' +
          field('provider','Провайдер',config.provider || 'openai') +
          field('url','API Base URL',config.base_url,'text','https://…/v1') +
          field('model','ID модели',config.model,'text','model-id') +
          field('key','API-ключ','','password') +
          field('pin','Цена входа, $/1M токенов',config.price_in,'number') +
          field('pout','Цена выхода, $/1M токенов',config.price_out,'number') +
          '</div>' + usageLine + '<footer><label><input id="' + prefix + '-enabled" type="checkbox"' + (config.is_enabled ? ' checked' : '') + '> Использовать модель</label>' +
          '<button type="button" id="save-' + prefix + '">Сохранить</button></footer></section>';
      }
      const auxiliaryHtml = auxCard('status-model','Модель статусов',
        'Отдельная модель коротких статусов ожидания; не входит в кластеры.',statusConfig,true) +
        auxCard('readable-model','Модель читабельного текста для озвучки',
        'Подготавливает ответы к озвучке; не входит в кластеры.',readableConfig,false);
      const body = sets.length ? sets.map(s => '<div class="ms-set"><div class="ms-head">' +
        '<b>' + escapeHtml(s.name) + '</b><span class="ms-slug">' + escapeHtml(s.slug) + '</span>' +
        '<span class="ms-access ' + (s.free_access ? 'all' : 'pro') + '">' + (s.free_access ? 'Для всех' : 'Только Pro') + '</span>' +
        '<span class="ms-description" title="' + escapeHtml(s.description || '') + '">' + escapeHtml(s.description || '') + '</span>' +
        '<span class="spacer" style="flex:1"></span><button data-edit-set="' + s.id + '">Изменить</button>' +
        '<button data-toggle="' + s.id + '" data-active="' + (s.is_active ? 1 : 0) + '">' + (s.is_active ? 'вкл' : 'выкл') + '</button>' +
        '<button data-del-set="' + s.id + '" title="Удалить кластер">' + icon('trash') + '</button>' +
        '</div><div class="ms-entries">' + ((s.entries || []).length ? s.entries.map(e =>
          '<div class="ms-entry"><span class="ms-pos">' + e.position + '</span><span class="ms-model">' + escapeHtml(e.model) + '</span>' +
          '<span class="ms-url" title="' + escapeHtml(e.base_url) + '">' + escapeHtml(e.base_url) + '</span>' +
          '<span class="ms-key">' + (e.has_api_key ? icon('check') : '—') + '</span><span class="ms-price">' +
          (e.price_in || e.price_out ? '$' + (e.price_in || 0) + ' / $' + (e.price_out || 0) : '—') + '</span>' +
          '<button data-edit-entry="' + s.id + '|' + e.id + '" title="ID, цены, контекст, Temperature">Изменить</button>' +
          '<button data-del-entry="' + s.id + '|' + e.id + '" title="Удалить">' + icon('trash') + '</button></div>').join('') : '<div class="ms-empty">нет моделей</div>') +
          (s.is_default
            ? '<span class="ms-default-tag">По умолчанию для всех</span>'
            : (s.is_active && (s.entries || []).some(e => e && e.is_active)
              ? '<button class="chip-btn ms-default-btn" data-default="' + s.id + '">' + icon('check') + 'Сделать моделью по умолчанию для всех</button>'
              : '<span class="ms-default-note">Для выбора по умолчанию нужна активная модель</span>')) +
          '<button class="chip-btn" data-add-entry="' + s.id + '">' + icon('plus') + 'модель</button></div></div>').join('') : '<p>Кластеров пока нет.</p>';
      root.innerHTML = '<div class="modal-back"><div class="modal" style="max-width:760px"><h3>Кластеры моделей</h3>' +
        '<div class="modal-body" style="max-height:62vh;overflow:auto">' + auxiliaryHtml + body + '</div><div class="row">' +
        '<button class="ghost" data-add-set>' + icon('plus') + 'Добавить кластер</button><span style="flex:1"></span>' +
        '<button class="solid" data-close>Закрыть</button></div></div></div>';
      $('[data-close]', root).addEventListener('click', () => { root.innerHTML = ''; });
      $('[data-add-set]', root).addEventListener('click', () => addSetForm(root, rerender));
      async function saveAux(prefix, endpoint) {
        const button = $('#save-' + prefix, root);
        button.disabled = true;
        try {
          await api.patch(endpoint, {
            provider: $('#'+prefix+'-provider',root).value.trim() || 'openai',
            base_url: $('#'+prefix+'-url',root).value.trim(),
            model: $('#'+prefix+'-model',root).value.trim(),
            api_key: $('#'+prefix+'-key',root).value,
            is_enabled: $('#'+prefix+'-enabled',root).checked,
            price_in: Math.max(0, Number($('#'+prefix+'-pin',root).value) || 0),
            price_out: Math.max(0, Number($('#'+prefix+'-pout',root).value) || 0),
          });
          toast('Настройки сохранены');
          await rerender();
        } catch (e) { toast('Не удалось сохранить: ' + e.message, 'error'); }
        finally { if ($('#save-' + prefix, root)) $('#save-' + prefix, root).disabled = false; }
      }
      $('#save-status-model', root).addEventListener('click', () => saveAux('status-model','/api/admin/status-model'));
      $('#save-readable-model', root).addEventListener('click', () => saveAux('readable-model','/api/admin/readable-text-model'));
      $$('[data-edit-set]', root).forEach(b => b.addEventListener('click', () => { const set = sets.find(s => s.id === b.dataset.editSet); if (set) editSetForm(root,set,rerender); }));
      $$('[data-del-set]', root).forEach(b => b.addEventListener('click', async () => { if (!confirm('Удалить кластер и его модели?')) return; await api.del('/api/admin/model-sets/' + b.dataset.delSet); await rerender(); await loadModelSets(); }));
      $$('[data-toggle]', root).forEach(b => b.addEventListener('click', async () => { await api.patch('/api/admin/model-sets/' + b.dataset.toggle, {is_active:b.dataset.active !== '1'}); await rerender(); await loadModelSets(); }));
      $$('[data-default]', root).forEach(b => b.addEventListener('click', async () => {
        try {
          await api.patch('/api/admin/model-sets/' + b.dataset.default, {is_default:true});
          await rerender();
          await loadModelSets();
          toast('Модель по умолчанию обновлена для всех пользователей');
        } catch (e) { toast('Не удалось изменить модель по умолчанию: ' + e.message, 'error'); }
      }));
      $$('[data-del-entry]', root).forEach(b => { const [sid,eid] = b.dataset.delEntry.split('|'); b.addEventListener('click', async () => { await api.del('/api/admin/model-sets/' + sid + '/entries/' + eid); await rerender(); await loadModelSets(); }); });
      $$('[data-edit-entry]', root).forEach(b => { const [sid,eid] = b.dataset.editEntry.split('|'); b.addEventListener('click', () => editEntryForm(root,sid,eid,rerender)); });
      $$('[data-add-entry]', root).forEach(b => b.addEventListener('click', () => addEntryForm(root,b.dataset.addEntry,rerender)));
    }
    await rerender();
  }

  function addSetForm(root, done) {
    adminForm(root, 'Новый кластер модели', [
      {id:'ms-name',label:'Название для пользователя',placeholder:'Например: Быстрая модель'},
      {id:'ms-desc',label:'Для каких задач',type:'textarea',placeholder:'Быстрые ответы, перевод, код, анализ…'},
      {id:'ms-access',label:'Доступность',type:'select',options:['Доступно всем (Free и Pro)','Только Pro']},
    ], async () => {
      await api.post('/api/admin/model-sets',{name:$('#ms-name').value.trim(),description:$('#ms-desc').value.trim(),free_access:$('#ms-access').value!=='Только Pro',route_type:'MAIN'});
      await loadModelSets();
    }, done);
  }

  function editSetForm(root, set, done) {
    adminForm(root,'Настройки кластера',[
      {id:'es-name',label:'Название для пользователя',value:set.name || ''},
      {id:'es-desc',label:'Для каких задач',type:'textarea',value:set.description || ''},
      {id:'es-access',label:'Доступность',type:'select',options:['Доступно всем (Free и Pro)','Только Pro'],selected:set.free_access?'Доступно всем (Free и Pro)':'Только Pro'},
    ],async()=>{
      await api.patch('/api/admin/model-sets/'+set.id,{name:$('#es-name').value.trim(),description:$('#es-desc').value.trim(),free_access:$('#es-access').value!=='Только Pro'});
      await loadModelSets();
    },done);
  }


  function addEntryForm(root, setId, done) {
    adminForm(root, 'Модель и цена кластера', [
      {id:'me-provider',label:'Совместимый провайдер',value:'openai'},
      {id:'me-url',label:'Base URL',placeholder:'https://…/v1'},
      {id:'me-model',label:'ID модели у провайдера',placeholder:'vendor/model-id'},
      {id:'me-key',label:'API-ключ',placeholder:'Ключ провайдера'},
      {id:'me-pos',label:'Позиция',type:'number',value:'0'},
      {id:'me-temp',label:'Temperature',type:'number',value:'0.2'},
      {id:'me-max',label:'Максимум токенов в ответе',type:'number',value:'32000',calc:true},
      {id:'me-ctx',label:'Максимальный контекст, токенов (0 = общий)',type:'number',value:'0',calc:true},
      {id:'me-pin',label:'Цена входа, $ за 1M токенов',type:'number',value:'0',calc:true},
      {id:'me-pout',label:'Цена выхода, $ за 1M токенов',type:'number',value:'0',calc:true},
      {id:'me-pcache',label:'Цена кэша, $ за 1M токенов (0 = цена входа)',type:'number',value:'0',calc:true},
      {type:'html',html:'<div id="me-calc" class="field-calc"></div>'},
    ], async () => {
      await api.post('/api/admin/model-sets/' + setId + '/entries', {
        provider:$('#me-provider').value.trim() || 'openai', base_url:$('#me-url').value.trim(),
        model:$('#me-model').value.trim(), api_key:$('#me-key').value,
        position:parseInt($('#me-pos').value,10) || 0, temperature:parseFloat($('#me-temp').value) || 0.2,
        max_tokens:parseInt($('#me-max').value,10) || 32000, context_len:parseInt($('#me-ctx').value,10) || 0,
        price_in:parseFloat($('#me-pin').value) || 0, price_out:parseFloat($('#me-pout').value) || 0,
        price_cache:parseFloat($('#me-pcache').value) || 0,
      });
      await loadModelSets();
    }, done);
    wireCostCalc(root,'me-calc',{in:'me-pin',out:'me-pout',cache:'me-pcache',ctx:'me-ctx',max:'me-max'});
  }

  async function editEntryForm(root, setId, entryId, done) {
    let entry = null;
    try {
      const sets = await api.get('/api/admin/model-sets');
      (sets || []).forEach(s => (s.entries || []).forEach(e => { if (e.id === entryId) entry = e; }));
    } catch (e) { /* ignore */ }
    if (!entry) { toast('Модель не найдена', 'error'); return; }
    adminForm(root, 'Настройка модели кластера', [
      {id:'ee-provider',label:'Совместимый провайдер',value:entry.provider || 'openai'},
      {id:'ee-model',label:'ID модели у провайдера',value:entry.model || ''},
      {id:'ee-url',label:'Base URL',value:entry.base_url || ''},
      {id:'ee-key',label:'API-ключ (пусто = не менять)',placeholder:'Новый ключ'},
      {id:'ee-temp',label:'Temperature',type:'number',value:String(entry.temperature != null ? entry.temperature : 0.2)},
      {id:'ee-max',label:'Максимум токенов в ответе',type:'number',value:String(entry.max_tokens || 32000),calc:true},
      {id:'ee-ctx',label:'Максимальный контекст, токенов (0 = общий)',type:'number',value:String(entry.context_len || 0),calc:true},
      {id:'ee-pin',label:'Цена входа, $ за 1M токенов',type:'number',value:String(entry.price_in || 0),calc:true},
      {id:'ee-pout',label:'Цена выхода, $ за 1M токенов',type:'number',value:String(entry.price_out || 0),calc:true},
      {id:'ee-pcache',label:'Цена кэша, $ за 1M токенов (0 = цена входа)',type:'number',value:String(entry.price_cache || 0),calc:true},
      {type:'html',html:'<div id="ee-calc" class="field-calc"></div>'},
    ], async () => {
      const body = {provider:$('#ee-provider').value.trim() || 'openai', model:$('#ee-model').value.trim(), base_url:$('#ee-url').value.trim(),
        temperature:parseFloat($('#ee-temp').value) || 0.2, max_tokens:parseInt($('#ee-max').value,10) || 32000,
        context_len:parseInt($('#ee-ctx').value,10) || 0, price_in:parseFloat($('#ee-pin').value) || 0,
        price_out:parseFloat($('#ee-pout').value) || 0, price_cache:parseFloat($('#ee-pcache').value) || 0};
      const key = $('#ee-key').value; if (key) body.api_key = key;
      await api.patch('/api/admin/model-sets/' + setId + '/entries/' + entryId, body);
      await loadModelSets(); toast('Модель и цены кластера обновлены');
    }, done);
    wireCostCalc(root,'ee-calc',{in:'ee-pin',out:'ee-pout',cache:'ee-pcache',ctx:'ee-ctx',max:'ee-max'});
  }

  // ---------- sidebar ----------
  function applySidebar() {
    const sb = $('#sidebar');
    const collapsed = state.sidebarCollapsed && window.innerWidth > 860;
    sb.classList.toggle('collapsed', collapsed);
    const openBtn = $('#sidebar-open-btn');
    if (openBtn) openBtn.classList.toggle('hidden', !collapsed);
  }
  function resetMobileSidebarMotion() {
    const sb = $('#sidebar');
    const overlay = $('#sidebar-overlay');
    if (!sb || !overlay) return;
    // Remove the drag lock first so clearing the inline position animates to the
    // class-defined resting position instead of snapping.
    sb.classList.remove('is-dragging');
    overlay.classList.remove('is-dragging');
    sb.style.removeProperty('transform');
    overlay.style.removeProperty('opacity');
  }
  function openMobileSidebar() {
    if (window.innerWidth > 860 || $('#add-to-chat-shell')?.classList.contains('open')) return;
    const sb = $('#sidebar');
    const overlay = $('#sidebar-overlay');
    sb.classList.add('open');
    overlay.classList.add('show');
    resetMobileSidebarMotion();
  }
  function closeMobileSidebar() {
    if (window.innerWidth <= 860) {
      $('#sidebar').classList.remove('open');
      $('#sidebar-overlay').classList.remove('show');
      resetMobileSidebarMotion();
    }
  }
  function bindSidebarGestures() {
    const surface = $('#main-screen');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebar-overlay');
    if (!surface || !sidebar || !overlay || surface.dataset.sidebarGestures === '1') return;
    surface.dataset.sidebarGestures = '1';

    let gesture = null;

    function onPointerDown(event) {
      if (window.innerWidth > 860 || !event.isPrimary || event.button !== 0 ||
          $('#add-to-chat-shell')?.classList.contains('open')) return;
      const startedOpen = sidebar.classList.contains('open');
      // The requested drawer gesture may start anywhere in the chat surface.
      // Vertical movement still keeps priority, so ordinary scrolling stays natural.
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startAt: event.timeStamp,
        lastX: event.clientX,
        lastAt: event.timeStamp,
        startedOpen,
        tracking: false,
        axisLocked: null,
        progress: startedOpen ? 1 : 0,
      };
    }

    function renderDrag(progress) {
      const width = Math.max(1, sidebar.getBoundingClientRect().width);
      const clamped = Math.max(0, Math.min(1, progress));
      gesture.progress = clamped;
      sidebar.style.transform = 'translate3d(' + ((clamped - 1) * width) + 'px, 0, 0)';
      overlay.style.opacity = String(clamped);
      if (clamped > 0.015) overlay.classList.add('show');
      else overlay.classList.remove('show');
    }

    function finishGesture(open) {
      const active = gesture;
      gesture = null;
      if (!active) return;
      sidebar.classList.toggle('open', !!open);
      overlay.classList.toggle('show', !!open);
      resetMobileSidebarMotion();
    }

    function onPointerMove(event) {
      const active = gesture;
      if (!active || event.pointerId !== active.pointerId || window.innerWidth > 860) return;
      if ($('#add-to-chat-shell')?.classList.contains('open')) {
        if (active.tracking) finishGesture(active.startedOpen);
        else gesture = null;
        return;
      }
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      if (!active.tracking) {
        const absX = Math.abs(dx), absY = Math.abs(dy);
        // Ignore diagonal finger jitter before locking the axis.
        if (Math.max(absX, absY) < 13) return;
        const clearVertical = absY >= 22 && absY > absX * 1.5;
        const clearHorizontal = absX >= 13 && absX > absY * 1.12;
        if (clearVertical) {
          active.axisLocked = 'vertical';
          gesture = null;
          return;
        }
        if (!clearHorizontal) return;
        active.axisLocked = 'horizontal';
        if ((active.startedOpen && dx >= 0) || (!active.startedOpen && dx <= 0)) {
          gesture = null;
          return;
        }
        active.tracking = true;
        sidebar.classList.add('is-dragging');
        overlay.classList.add('is-dragging', 'show');
        try { surface.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is best-effort. */ }
      }
      if (active.axisLocked !== 'horizontal' || !active.tracking) return;
      // After horizontal locking, vertical drift cannot hand the gesture back to page scrolling.
      if (event.cancelable) event.preventDefault();
      const width = Math.max(1, sidebar.getBoundingClientRect().width);
      renderDrag(active.startedOpen ? 1 + dx / width : dx / width);
      active.lastX = event.clientX;
      active.lastAt = event.timeStamp;
    }

    function onPointerUp(event) {
      const active = gesture;
      if (!active || event.pointerId !== active.pointerId) return;
      if (!active.tracking) {
        gesture = null;
        return;
      }
      const dx = event.clientX - active.startX;
      const width = Math.max(1, sidebar.getBoundingClientRect().width);
      const progress = Math.max(0, Math.min(1, active.startedOpen ? 1 + dx / width : dx / width));
      const elapsed = Math.max(1, event.timeStamp - active.startAt);
      const velocity = dx / elapsed;
      const flick = Math.abs(dx) > 22 && Math.abs(velocity) > 0.55;
      const shouldOpen = flick ? velocity > 0 : progress >= (active.startedOpen ? 0.52 : 0.38);
      finishGesture(shouldOpen);
    }

    function onPointerCancel(event) {
      const active = gesture;
      if (!active || event.pointerId !== active.pointerId) return;
      finishGesture(active.startedOpen);
    }

    surface.addEventListener('pointerdown', onPointerDown, {passive: true});
    surface.addEventListener('pointermove', onPointerMove, {passive: false});
    surface.addEventListener('pointerup', onPointerUp, {passive: true});
    surface.addEventListener('pointercancel', onPointerCancel, {passive: true});
  }
  function bindSidebar() {
    bindSidebarGestures();
    $('#new-chat-btn').addEventListener('click', () => newChat('chat'));
    const apiQuick = $('#api-quick-btn');
    if (apiQuick) apiQuick.addEventListener('click', () => openApiWorkspace());
    const capabilitiesButton = $('#capabilities-btn');
    if (capabilitiesButton) capabilitiesButton.addEventListener('click', () => openCapabilitiesWorkspace());
    $('#capabilities-workspace-back')?.addEventListener('click', closeCapabilitiesWorkspace);
    const brainQuick = $('#brain-quick-btn');
    if (brainQuick) brainQuick.addEventListener('click', () => openSecondBrain());
    $('#api-workspace-back')?.addEventListener('click', closeApiWorkspace);
    $('#brain-workspace-back')?.addEventListener('click', closeBrainWorkspace);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if ($('#api-workspace-shell')?.classList.contains('open')) closeApiWorkspace();
      if ($('#brain-workspace-shell')?.classList.contains('open')) closeBrainWorkspace();
      if ($('#capabilities-workspace-shell')?.classList.contains('open')) closeCapabilitiesWorkspace();
    });
    // Code Agent is temporarily unavailable; never create a project/chat from this control.
    const legacySidebarLimits = $('#sidebar-limits-btn');
    if (legacySidebarLimits) legacySidebarLimits.addEventListener('click', openLimits);
    const moreButton = $('#sidebar-more-btn');
    const moreContent = $('#sidebar-more-content');
    if (moreButton && moreContent) {
      moreButton.addEventListener('click', () => {
        const expanded = moreButton.getAttribute('aria-expanded') === 'true';
        moreButton.setAttribute('aria-expanded', String(!expanded));
        moreContent.classList.toggle('hidden', expanded);
      });
    }
    // Консилиум намеренно не возвращаем: восстановлен только режим Код-агента.
    $('#collapse-btn').addEventListener('click', () => {
      if (window.innerWidth <= 860) { closeMobileSidebar(); return; }
      state.sidebarCollapsed = true;
      localStorage.setItem('cs_sidebar', '1');
      applySidebar();
    });
    $('#sidebar-open-btn').addEventListener('click', () => {
      state.sidebarCollapsed = false;
      localStorage.setItem('cs_sidebar', '0');
      applySidebar();
    });
    $('#share-btn').addEventListener('click', openShare);
    $('#menu-btn').addEventListener('click', () => {
      if ($('#sidebar').classList.contains('open')) closeMobileSidebar(); else openMobileSidebar();
    });
    $('#sidebar-overlay').addEventListener('click', closeMobileSidebar);
    let t = null;
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = e.target.value.trim(); loadChats(); }, 250);
    });
    $('#chat-title').addEventListener('click', event => {
      if (event.target.closest('.chat-title-search-input, .chat-search-close')) return;
      renameCurrentChat();
    });
    $('#messages').addEventListener('scroll', () => {
      const box = $('#messages');
      state.stickBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 70;
      updateScrollDownButton();
    });
    $('#scroll-to-bottom-btn')?.addEventListener('click', () => {
      const box = $('#messages');
      if (!box) return;
      state.stickBottom = true;
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
      requestAnimationFrame(updateScrollDownButton);
    });
    window.addEventListener('resize', updateScrollDownButton, { passive: true });
    $('#settings-btn').addEventListener('click', () => {
      const u = state.user || {};
      const isAdmin = !!u.is_admin;
      const who = u.name || u.email || 'Аккаунт';
      openModal({
        title: 'Настройки и профиль',
        okText: 'Закрыть',
        extraClass: 'profile-sheet bottom-sheet',
        body:
          '<div class="profile-box">' +
          '<img class="profile-ava" src="/api/avatars/' + (u.avatar || 0) + '.svg" alt="" />' +
          '<div class="profile-info"><b>' + escapeHtml(who) + '</b>' +
          '<span>' + escapeHtml(u.email || '') + '</span>' +
          '<span class="role-chip">' + (isAdmin ? 'администратор' : 'пользователь') + '</span></div>' +
          '</div>' +
          '<button type="button" class="profile-limits-action" id="profile-limits-btn">' +
          '<span class="profile-limits-icon">' + icon('gauge') + '</span>' +
          '<span class="profile-limits-copy"><strong>Лимиты и баланс</strong><small>Расход, остаток и статистика использования</small></span>' +
          '<span class="profile-limits-arrow">' + icon('chevron') + '</span></button>' +
          '<h4 class="sec">Параметры</h4>' +
          '<p class="usage-note">Поиск в интернете: всегда включён · Память: ' +
          ((state.memories || []).length) + ' записей<br/>' +
          'Тема: тёплая светлая (Claude-like); тёмная — автоматически по системе.</p>' +
          '<h4 class="sec">Разделы</h4>' +
          '<div class="settings-grid">' +
          '<button class="chip-btn" id="set-memory">' + icon('sparkle') + 'Память</button>' +
          '<button class="chip-btn" id="set-links">' + icon('link') + 'Мои ссылки</button>' +
          '<button class="chip-btn" id="set-files">' + icon('folder') + 'Файлы</button>' +
          (isAdmin
            ? '<button type="button" class="chip-btn profile-admin-limits" id="profile-admin-limits-btn">' + icon('settings') + 'Настройки лимитов</button>' +
              '<button class="chip-btn" id="open-ms">' + icon('settings') + 'Model Sets</button>' +
              '<button class="chip-btn" id="open-api-gateway">' + icon('plug') + 'Настройки API</button>' +
              '<button class="chip-btn" id="open-brain-config">' + icon('brain') + 'Настройки Второго мозга</button>' +
              '<button class="chip-btn" id="open-ready-answers">' + icon('book') + 'База готовых ответов</button>' +
              '<button class="chip-btn" id="open-stats">' + icon('chart') + 'Статистика</button>' +
              '<button class="chip-btn" id="open-allchats">' + icon('file') + 'Все чаты</button>'
            : '') +
          '</div>' +
          '<div style="margin-top:18px"><button class="chip-btn danger" id="set-logout">' +
          icon('logout') + 'Выйти из аккаунта</button></div>',
        onOk: () => true,
      });
      const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
      on('#set-memory', () => { closeModal(); openMemory(); });
      on('#set-links', () => { closeModal(); openLinks(); });
      on('#set-files', () => { closeModal(); toggleFiles(true); });
      on('#profile-limits-btn', () => { closeModal(); openUsageModal({ refresh: true }); });
      on('#profile-admin-limits-btn', () => { closeModal(); openLimits(); });
      on('#open-ms', () => { closeModal(); openModelSetsAdmin(); });
      on('#open-api-gateway', () => { closeModal(); openApiAdminSettings(); });
      on('#open-brain-config', () => { closeModal(); openBrainAdminSettings(); });
      on('#open-ready-answers', () => { closeModal(); openReadyAnswersAdmin(); });
      on('#open-stats', () => { closeModal(); openAdminStats(); });
      on('#open-allchats', () => { closeModal(); openAdminChats(); });
      on('#set-logout', async () => {
        try { await api.post('/api/auth/logout'); } catch (e) { /* noop */ }
        location.reload();
      });
    });
    window.addEventListener('resize', () => {
      applySidebar();
      $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
      if (window.innerWidth > 860) {
        $('#sidebar').classList.remove('open');
        $('#sidebar-overlay').classList.remove('show');
        resetMobileSidebarMotion();
      }
    });
  }

  // ---------- share / public ----------
  function chatTranscriptText() {
    const chat = state.chats.find(item => String(item.id) === String(state.currentChatId));
    const title = String(chat && chat.title || 'AI CH').trim() || 'AI CH';
    const entries = allMessages(state.tree);
    const parts = entries.map(entry => {
      const node = entry && entry.node;
      if (!node) return '';
      const label = node.role === 'user' ? 'Вы' : (node.role === 'system' ? 'Система' : 'AI-Ch');
      const content = copyableAnswerText(node.content || '');
      const attachments = Array.isArray(node.attachments) ? node.attachments
        .map(item => item && item.original_name ? String(item.original_name) : '')
        .filter(Boolean) : [];
      return '### ' + label + '\n\n' + content +
        (attachments.length ? '\n\nВложения: ' + attachments.join(', ') : '');
    }).filter(Boolean);
    return '# ' + title + '\n\n' + parts.join('\n\n---\n\n');
  }

  async function copyAllChatText() {
    const text = chatTranscriptText();
    if (!text.trim()) { toast('В чате пока нечего копировать.', 'error'); return; }
    const ok = await copyText(text);
    toast(ok ? 'Весь чат скопирован' : 'Не удалось скопировать чат', ok ? '' : 'error');
  }

  function downloadChatText() {
    const text = chatTranscriptText();
    if (!text.trim()) { toast('В чате пока нечего скачивать.', 'error'); return; }
    const chat = state.chats.find(item => String(item.id) === String(state.currentChatId));
    const base = String(chat && chat.title || 'ai-ch').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 90) || 'ai-ch';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = base + '.md';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Подготовлен файл чата для скачивания.');
  }

  function closeChatSearch() {
    clearChatSearchHighlights();
    const title = $('#chat-title');
    if (!title) return;
    title.classList.remove('chat-title-search');
    refreshCurrentChatTitle(state.chatSearchPreviousTitle || 'AI CH');
    state.chatSearchPreviousTitle = '';
    state.chatSearchMatchIndex = 0;
  }

  function startChatSearch() {
    const title = $('#chat-title');
    if (!title || !state.currentChatId) {
      toast('Сначала откройте чат', 'error');
      return;
    }
    if (title.classList.contains('chat-title-search')) {
      $('.chat-title-search-input', title)?.focus();
      return;
    }
    state.chatSearchPreviousTitle = title.textContent || 'AI CH';
    title.classList.add('chat-title-search');
    title.innerHTML = '<span class="chat-search-leading" aria-hidden="true">' + icon('search') + '</span>' +
      '<input type="search" class="chat-title-search-input" aria-label="Найти в чате" placeholder="Найти в чате" autocomplete="off" />' +
      '<button type="button" class="chat-search-close" aria-label="Закрыть поиск" title="Закрыть поиск">' + icon('x') + '</button>';
    const input = $('.chat-title-search-input', title);
    const close = $('.chat-search-close', title);
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.chatSearchMatchIndex = 0;
        highlightChatSearch(input.value, false);
      }, 60);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeChatSearch();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        highlightChatSearch(input.value, true);
      }
    });
    close.addEventListener('click', event => {
      event.stopPropagation();
      closeChatSearch();
    });
    input.focus();
  }

  function clearChatSearchHighlights() {
    const messages = $('#messages');
    if (!messages) return;
    $$('mark.chat-search-match', messages).forEach(mark => {
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
    });
    $$('.msg .content.md', messages).forEach(content => content.normalize());
  }

  function highlightChatSearch(query, moveToNext) {
    clearChatSearchHighlights();
    const term = String(query || '').trim();
    if (!term) { state.chatSearchMatchIndex = 0; return; }
    const escaped = term.split('').map(char =>
      '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char
    ).join('');
    let regex;
    try { regex = new RegExp(escaped, 'gi'); } catch (_) { return; }
    const messages = $('#messages');
    const roots = $$('.msg .content.md', messages);
    roots.forEach(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(textNode) {
          const parent = textNode.parentElement;
          if (!parent || parent.closest('pre,code,script,style,textarea,button,mark,svg,.katex')) return NodeFilter.FILTER_REJECT;
          return (textNode.nodeValue || '').toLocaleLowerCase().includes(term.toLocaleLowerCase())
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes = [];
      let textNode;
      while ((textNode = walker.nextNode())) nodes.push(textNode);
      nodes.forEach(node => {
        const value = node.nodeValue || '';
        regex.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let match;
        while ((match = regex.exec(value))) {
          if (match.index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)));
          const mark = document.createElement('mark');
          mark.className = 'chat-search-match';
          mark.textContent = match[0];
          fragment.appendChild(mark);
          cursor = match.index + match[0].length;
          if (!match[0].length) regex.lastIndex++;
        }
        if (!cursor) return;
        if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
        node.replaceWith(fragment);
      });
    });
    const marks = $$('mark.chat-search-match', messages);
    if (!marks.length) {
      state.chatSearchMatchIndex = 0;
      return;
    }
    if (moveToNext) state.chatSearchMatchIndex = (state.chatSearchMatchIndex + 1) % marks.length;
    else state.chatSearchMatchIndex = 0;
    marks.forEach((mark, index) => mark.classList.toggle('is-current', index === state.chatSearchMatchIndex));
    marks[state.chatSearchMatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function openChatProjectPicker(chatId) {
    let projects = [];
    try { projects = await api.get('/api/projects'); }
    catch (error) { toast('Не удалось загрузить проекты: ' + error.message, 'error'); return; }
    if (!Array.isArray(projects) || !projects.length) {
      openModal({
        title: 'Добавить чат в проект',
        body: '<p>Сначала создайте проект — после этого его можно будет выбрать для текущего чата.</p>' +
          '<button type="button" class="chip-btn" id="chat-project-create-first">' + icon('plus') + ' Создать проект</button>',
        okText: 'Закрыть',
        onOk: () => true,
      });
      $('#chat-project-create-first')?.addEventListener('click', () => {
        closeModal();
        openProjectsWorkspace().then(() => {
          projectWorkspaceEditor = { id: '', title: '', description: '' };
          renderProjectsWorkspace();
          $('#workspace-project-name')?.focus();
        });
      });
      return;
    }
    const activeChat = (state.chats || []).find(chat => chat && String(chat.id) === String(chatId));
    openModal({
      title: 'Добавить чат в проект',
      body: '<p>Выберите проект для текущего чата.</p><label for="chat-project-choice">Проект</label>' +
        '<select id="chat-project-choice" class="model-select"><option value="">Без проекта</option>' + projects.map(project =>
          '<option value="' + escapeHtml(project.id) + '"' +
          (activeChat && String(activeChat.project_id || '') === String(project.id) ? ' selected' : '') + '>' +
          escapeHtml(project.title || 'Без названия') + '</option>'
        ).join('') + '</select>',
      onOk: async root => {
        const projectId = String($('#chat-project-choice', root)?.value || '');
        const previousId = String(activeChat && activeChat.project_id || '');
        if (projectId !== previousId) {
          const previousName = projects.find(item => String(item.id) === previousId)?.title || 'Без проекта';
          const nextName = projects.find(item => String(item.id) === projectId)?.title || 'Без проекта';
          if (!confirm('Изменить проект чата с «' + previousName + '» на «' + nextName + '»?')) return false;
        }
        try {
          const updated = await api.patch('/api/chats/' + encodeURIComponent(chatId), { project_id: projectId || null });
          const index = state.chats.findIndex(item => item && item.id === updated.id);
          if (index >= 0) state.chats[index] = { ...state.chats[index], ...updated };
          state.chatListVersion += 1;
          renderChatList();
          const project = projects.find(item => String(item.id) === projectId);
          toast(projectId ? 'Чат перемещён в проект «' + (project && project.title || 'Проект') + '»' : 'Чат убран из проекта');
          return true;
        } catch (error) {
          toast('Не удалось добавить чат: ' + error.message, 'error');
          return false;
        }
      },
    });
  }

  async function openCurrentChatFilesModal() {
    const nodes = allMessages(state.tree).map(entry => entry && entry.node).filter(Boolean);
    const byId = new Map();
    nodes.forEach(node => (Array.isArray(node.attachments) ? node.attachments : []).forEach(file => {
      if (!file) return;
      const id = String(file.file_id || file.id || '');
      if (!id) return;
      const previous = byId.get(id) || {};
      byId.set(id, {
        ...previous, ...file, file_id: id,
        source: node.role === 'assistant' ? 'ai' : (previous.source || 'user'),
        name: file.name || file.original_name || previous.name || 'Файл',
      });
    }));
    const files = Array.from(byId.values());
    openModal({
      title: 'Файлы в этом чате',
      okText: 'Закрыть',
      body: files.length ? '<div class="chat-attached-files-list">' + files.map(file =>
        '<a class="chat-attached-file" href="/api/files/' + encodeURIComponent(file.file_id) + '/download" target="_blank" rel="noopener noreferrer">' +
        '<span class="chat-attached-file-icon">' + icon(file.source === 'ai' ? 'file' : 'paperclip') + '</span>' +
        '<span class="chat-attached-file-copy"><strong>' + escapeHtml(file.name) + '</strong><small>' +
        (file.source === 'ai' ? 'Создано AI CH' : 'Загружено вами') +
        (Number.isFinite(Number(file.size)) ? ' · ' + formatSize(Number(file.size)) : '') +
        '</small></span>' + icon('download') + '</a>'
      ).join('') + '</div>' : '<div class="files-workspace-empty chat-no-files"><span class="files-empty-art">' +
        icon('folder') + '</span><strong>В этом чате пока нет файлов</strong><p>Загруженные и созданные файлы появятся здесь после прикрепления к сообщению.</p></div>',
      onOk: () => true,
    });
  }

  async function openShare() {
    const chatId = state.currentChatId;
    if (!chatId) { toast('Сначала откройте чат', 'error'); return; }
    const shell = $('#add-to-chat-shell');
    const content = $('#add-chat-share-content');
    if (!shell || !content) { toast('Меню «Поделиться» недоступно.', 'error'); return; }

    // Open the actual + sheet immediately; never wait for share/status API calls before showing it.
    openAddToChatSheet();
    setAddChatView('share');
    content.innerHTML = '<p class="usage-note share-loading">Открываю действия чата…</p>';

    let st;
    try {
      st = await api.get('/api/chats/' + encodeURIComponent(chatId) + '/share');
    } catch (e) {
      if (state.currentChatId === chatId && addChatActiveView === 'share') {
        content.innerHTML = '<p class="usage-note">Не удалось загрузить ссылку чата. Закройте меню и попробуйте ещё раз.</p>';
      }
      toast('Ошибка: ' + e.message, 'error');
      return;
    }
    if (state.currentChatId !== chatId || addChatActiveView !== 'share') return;

    const url = st.share_token ? (location.origin + '/?share=' + st.share_token) : '';
    const answerNodes = allMessages(state.tree).map(entry => entry && entry.node)
      .filter(node => node && node.role === 'assistant' && node.status === 'completed' && String(node.content || '').trim());

    const renderAnswerActions = () => answerNodes.map((node, index) => {
      const number = index + 1;
      const id = escapeHtml(String(node.id));
      const readable = state.readableText[node.id];
      const readableButton = readable && readable.status === 'ready' && String(readable.text || '').trim()
        ? '<button type="button" class="add-chat-action share-answer-action" data-share-copy-readable="' + id + '">' +
          '<span class="add-chat-row-icon">' + icon('copy') + '</span><span class="add-chat-action-copy"><strong>Читабельный текст · ответ ' + number + '</strong></span></button>' : '';
      const audioButton = state.audioReady[node.id]
        ? '<a class="add-chat-action share-answer-action" data-share-audio href="/api/messages/' + encodeURIComponent(node.id) +
          '/audio/file" download="AI-Ch-ответ-' + number + '"><span class="add-chat-row-icon">' + icon('download') +
          '</span><span class="add-chat-action-copy"><strong>Аудио · ответ ' + number + '</strong></span></a>' : '';
      return '<div class="add-chat-action-group share-answer-row">' +
        '<button type="button" class="add-chat-action share-copy-answer" data-share-copy-answer="' + id + '">' +
        '<span class="add-chat-row-icon">' + icon('copy') + '</span><span class="add-chat-action-copy"><strong>Копировать ответ ' + number + '</strong></span></button>' +
        readableButton + audioButton + '</div>';
    }).join('');

    const linkSection = st.is_public
      ? '<p>Чат открыт по ссылке — доступ только на чтение.</p>' +
        '<input id="share-url" readonly value="' + escapeHtml(url) + '" />' +
        '<div class="share-link-actions">' +
        '<button type="button" class="add-chat-action" id="copy-link"><span class="add-chat-row-icon">' + icon('copy') +
        '</span><span class="add-chat-action-copy"><strong>Копировать ссылку</strong></span></button>' +
        '<button type="button" class="add-chat-action" id="open-link"><span class="add-chat-row-icon">' + icon('link') +
        '</span><span class="add-chat-action-copy"><strong>Открыть ссылку</strong></span></button>' +
        '<button type="button" class="add-chat-action" id="stop-share"><span class="add-chat-row-icon">' + icon('x') +
        '</span><span class="add-chat-action-copy"><strong>Отключить ссылку</strong></span></button></div>'
      : '<p>Создать публичную ссылку на этот чат? Доступ будет только на чтение.</p>' +
        '<button type="button" class="add-chat-action" id="start-share"><span class="add-chat-row-icon">' + icon('link') +
        '</span><span class="add-chat-action-copy"><strong>Создать ссылку</strong><small>Доступ только на чтение</small></span></button>';

    content.innerHTML =
      '<div class="add-chat-sheet-content share-sheet-body">' +
        '<section class="share-link-section share-link-section-first"><strong>Ссылка на чат</strong><div id="share-link-content">' + linkSection + '</div></section>' +
        '<div class="add-chat-action-group">' +
          '<button type="button" class="add-chat-action" id="chat-action-new"><span class="add-chat-row-icon">' + icon('plus') +
          '</span><span class="add-chat-action-copy"><strong>Новый чат</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="chat-action-pin"><span class="add-chat-row-icon">' + icon('map-pin') +
          '</span><span class="add-chat-action-copy"><strong>' + ((state.chats.find(chat => chat && chat.id === chatId)?.is_pinned) ? 'Открепить чат' : 'Закрепить чат') + '</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="chat-action-project"><span class="add-chat-row-icon">' + icon('folder') +
          '</span><span class="add-chat-action-copy"><strong>Добавить в проект</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="chat-action-files"><span class="add-chat-row-icon">' + icon('file') +
          '</span><span class="add-chat-action-copy"><strong>Загруженные файлы</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="chat-action-find"><span class="add-chat-row-icon">' + icon('search') +
          '</span><span class="add-chat-action-copy"><strong>Найти в чате</strong></span></button>' +
        '</div>' +
        '<div class="add-chat-action-group">' +
          '<button type="button" class="add-chat-action" id="copy-all-chat"><span class="add-chat-row-icon">' + icon('copy') +
          '</span><span class="add-chat-action-copy"><strong>Скопировать весь чат</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="download-chat"><span class="add-chat-row-icon">' + icon('download') +
          '</span><span class="add-chat-action-copy"><strong>Скачать чат</strong></span></button>' +
          '<button type="button" class="add-chat-action" id="create-chat-branch"><span class="add-chat-row-icon">' + icon('git-branch') +
          '</span><span class="add-chat-action-copy"><strong>Создать ветку в новом чате</strong></span></button>' +
        '</div>' +
        '<section class="share-answer-actions"><strong>Отдельные ответы</strong><div id="share-answer-list">' +
        (renderAnswerActions() || '<p class="usage-note">Завершённых ответов пока нет.</p>') + '</div></section>' +
      '</div>';

    // A single delegated handler survives refreshes of the answer list and repeated opens.
    if (content.dataset.shareBound !== '1') {
      content.dataset.shareBound = '1';
      content.addEventListener('click', async event => {
        const button = event.target.closest('button, a');
        if (!button || !content.contains(button)) return;
        const activeChatId = state.currentChatId;
        if (button.id === 'chat-action-new') {
          closeAddToChatSheet();
          await newChat('chat');
        } else if (button.id === 'chat-action-pin') {
          closeAddToChatSheet();
          if (activeChatId) await toggleChatPin(activeChatId);
        } else if (button.id === 'chat-action-project') {
          closeAddToChatSheet();
          if (activeChatId) openChatProjectPicker(activeChatId);
        } else if (button.id === 'chat-action-files') {
          closeAddToChatSheet();
          openCurrentChatFilesModal();
        } else if (button.id === 'chat-action-find') {
          closeAddToChatSheet();
          startChatSearch();
        } else if (button.id === 'start-share') {
          button.disabled = true;
          try { await api.post('/api/chats/' + encodeURIComponent(activeChatId) + '/share'); }
          catch (e) { button.disabled = false; toast('Ошибка: ' + e.message, 'error'); return; }
          await openShare();
        } else if (button.id === 'stop-share') {
          button.disabled = true;
          try { await api.del('/api/chats/' + encodeURIComponent(activeChatId) + '/share'); }
          catch (e) { button.disabled = false; toast('Ошибка: ' + e.message, 'error'); return; }
          await openShare();
        } else if (button.id === 'create-chat-branch') {
          if (!activeChatId) return;
          button.disabled = true;
          try {
            const created = await api.post('/api/chats/' + encodeURIComponent(activeChatId) + '/branch');
            if (!created || typeof created.id !== 'string' || !created.id) throw new Error('Сервер не вернул ID новой ветки');
            closeAddToChatSheet();
            upsertChat(created);
            state.chatListVersion += 1;
            await loadChats();
            const opened = await openChat(created.id);
            if (opened) toast('Ветка создана. Исходный чат сохранён.');
          } catch (error) {
            button.disabled = false;
            toast('Не удалось создать ветку: ' + (error.message || error), 'error');
          }
        } else if (button.id === 'copy-link') {
          const link = String($('#share-url')?.value || '');
          const ok = await copyText(link);
          toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать', ok ? '' : 'error');
        } else if (button.id === 'open-link') {
          const link = String($('#share-url')?.value || '');
          if (link) window.open(link, '_blank', 'noopener');
        } else if (button.id === 'copy-all-chat') {
          copyAllChatText();
        } else if (button.id === 'download-chat') {
          downloadChatText();
        } else if (button.dataset.shareCopyAnswer) {
          const node = findNode(state.tree, button.dataset.shareCopyAnswer);
          if (!node) return;
          const ok = await copyText(copyableAnswerText(node.content || ''));
          toast(ok ? 'Ответ скопирован' : 'Не удалось скопировать ответ', ok ? '' : 'error');
        } else if (button.dataset.shareCopyReadable) {
          const readable = state.readableText[button.dataset.shareCopyReadable];
          if (!readable || readable.status !== 'ready' || !String(readable.text || '').trim()) {
            toast('Читабельный текст ещё не готов', 'error'); return;
          }
          const ok = await copyText(readable.text);
          toast(ok ? 'Читабельный текст скопирован' : 'Не удалось скопировать текст', ok ? '' : 'error');
        }
      });
    }

    // Refresh just a handful of recent answer statuses in the background. The sheet is already usable.
    Promise.all(answerNodes.slice(-5).map(async node => {
      await Promise.all([refreshReadableTextStatus(node.id), refreshAudioStatus(node.id)]);
    })).then(() => {
      if (state.currentChatId !== chatId || addChatActiveView !== 'share') return;
      const box = $('#share-answer-list');
      if (box) box.innerHTML = renderAnswerActions() || '<p class="usage-note">Завершённых ответов пока нет.</p>';
    }).catch(() => { /* action sheet remains usable with cached statuses */ });
  }

  async function currentUserOrNull() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function showPublicView(token) {
    let data;
    try {
      const r = await fetch('/api/public/chats/' + encodeURIComponent(token),
        { credentials: 'same-origin' });
      if (!r.ok) {
        throw new Error(r.status === 404 ? 'ссылка недействительна или отключена' : 'HTTP ' + r.status);
      }
      data = await r.json();
    } catch (e) {
      showAuth();
      $('#auth-error').textContent = 'Не удалось открыть ссылку: ' + e.message;
      return;
    }

    state.user = await currentUserOrNull();
    state.publicToken = token;
    state.readonly = true;
    state.tree = data.messages || [];
    state.currentChatId = null;
    state.choices = {};

    $('#auth-screen').classList.add('hidden');
    $('#main-screen').classList.remove('hidden');
    $('#sidebar').classList.add('collapsed');
    $('#chat-title').textContent = data.title || 'Публичный чат';
    $('#composer').classList.add('hidden');
    $('#share-btn').classList.add('hidden');

    const banner = document.createElement('div');
    banner.className = 'public-banner';
    banner.innerHTML = '<span>' + icon('link') + ' Публичный чат' +
      (data.author ? ' · ' + escapeHtml(data.author) : '') + ' — только чтение</span>' +
      (state.user
        ? '<button id="fork-btn">Продолжить у себя</button>'
        : '<button id="login-btn">Войти, чтобы продолжить</button>');
    $('#chat-area').insertBefore(banner, $('#messages'));

    const fb = $('#fork-btn');
    if (fb) fb.addEventListener('click', async () => {
      try {
        await api.post('/api/public/chats/' + encodeURIComponent(token) + '/fork');
        location.href = '/';
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    const lb = $('#login-btn');
    if (lb) lb.addEventListener('click', () => { location.href = '/'; });

    renderMessages();
  }

  // ---------- local file generation ----------
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const dt = new Date();
    const dosTime = ((dt.getHours() << 11) | (dt.getMinutes() << 5) | Math.floor(dt.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate()) & 0xFFFF;
    entries.forEach((e) => {
      const nameBytes = enc.encode(e.name);
      const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local, data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);
      offset += local.length + data.length;
    });
    const centralSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textToDocx(text) {
    const paras = String(text || '').split(/\r?\n/).map((line) =>
      '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r></w:p>').join('');
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + paras + '<w:sectPr/></w:body></w:document>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: doc },
    ]);
  }

  function colName(i) {
    let s = '';
    i += 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function rowsToXlsx(rows) {
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((c, j) =>
        '<c r="' + colName(j) + (i + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlEsc(c) + '</t></is></c>').join('') + '</row>').join('') +
      '</sheetData></worksheet>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const wbrels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbrels },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  }

  function rowsToOds(rows) {
    const content = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<office:document-content ' +
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">' +
      '<office:body><office:spreadsheet><table:table table:name="Sheet1">' +
      rows.map((r) => '<table:table-row>' + r.map((c) =>
        '<table:table-cell office:value-type="string"><text:p>' + xmlEsc(c) +
        '</text:p></table:table-cell>').join('') + '</table:table-row>').join('') +
      '</table:table></office:spreadsheet></office:body></office:document-content>';
    const manifest = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '</manifest:manifest>';
    return zipStore([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet' },
      { name: 'content.xml', data: content },
      { name: 'META-INF/manifest.xml', data: manifest },
    ]);
  }

  function printPdf(title, html) {
    const w = window.open('', '_blank');
    if (!w) { toast('Разрешите всплывающие окна для PDF', 'error'); return; }
    w.document.write('<html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
      '<style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;padding:34px;' +
      'max-width:820px;margin:0 auto;color:#1f1e1d}pre{background:#f4f2ec;padding:12px;border-radius:8px;' +
      'overflow-x:auto;white-space:pre-wrap}code{font-family:ui-monospace,Menlo,monospace;font-size:13px}' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}' +
      'h1,h2,h3{margin-top:1.2em}blockquote{border-left:3px solid #ddd;margin:0;padding:2px 14px;color:#666}' +
      '</style></head><body>' + html + '</body></html>');
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* noop */ } }, 500);
  }

  function codeDownloadInfo(lang) {
    const rawKey = String(lang || '').trim().toLowerCase().split(/\s+/)[0];
    const aliases = {
      python: 'py', python3: 'py', py3: 'py',
      javascript: 'js', nodejs: 'js', mjs: 'js',
      typescript: 'ts', htm: 'html',
      bash: 'sh', shell: 'sh', zsh: 'sh',
      cxx: 'cpp', cc: 'cpp', 'c++': 'cpp',
      csharp: 'cs', 'c#': 'cs',
      yml: 'yaml', md: 'markdown', gql: 'graphql',
      rs: 'rust', kt: 'kotlin', golang: 'go'
    };
    const key = aliases[rawKey] || rawKey;
    const known = {
      py: ['main.py', 'text/x-python;charset=utf-8'],
      js: ['script.js', 'text/javascript;charset=utf-8'],
      ts: ['index.ts', 'text/plain;charset=utf-8'],
      jsx: ['App.jsx', 'text/plain;charset=utf-8'],
      tsx: ['App.tsx', 'text/plain;charset=utf-8'],
      html: ['index.html', 'text/html;charset=utf-8'],
      css: ['styles.css', 'text/css;charset=utf-8'],
      scss: ['styles.scss', 'text/plain;charset=utf-8'],
      json: ['data.json', 'application/json;charset=utf-8'],
      jsonc: ['data.jsonc', 'text/plain;charset=utf-8'],
      json5: ['data.json5', 'text/plain;charset=utf-8'],
      yaml: ['config.yaml', 'text/yaml;charset=utf-8'],
      markdown: ['README.md', 'text/markdown;charset=utf-8'],
      sql: ['query.sql', 'text/plain;charset=utf-8'],
      sh: ['script.sh', 'text/plain;charset=utf-8'],
      ps1: ['script.ps1', 'text/plain;charset=utf-8'],
      powershell: ['script.ps1', 'text/plain;charset=utf-8'],
      java: ['Main.java', 'text/x-java-source;charset=utf-8'],
      c: ['main.c', 'text/plain;charset=utf-8'],
      cpp: ['main.cpp', 'text/plain;charset=utf-8'],
      cs: ['Program.cs', 'text/plain;charset=utf-8'],
      go: ['main.go', 'text/plain;charset=utf-8'],
      rust: ['main.rs', 'text/plain;charset=utf-8'],
      php: ['index.php', 'text/plain;charset=utf-8'],
      ruby: ['main.rb', 'text/plain;charset=utf-8'],
      kotlin: ['Main.kt', 'text/plain;charset=utf-8'],
      swift: ['main.swift', 'text/plain;charset=utf-8'],
      dart: ['main.dart', 'text/plain;charset=utf-8'],
      lua: ['main.lua', 'text/plain;charset=utf-8'],
      r: ['script.R', 'text/plain;charset=utf-8'],
      perl: ['script.pl', 'text/plain;charset=utf-8'],
      scala: ['Main.scala', 'text/plain;charset=utf-8'],
      groovy: ['script.groovy', 'text/plain;charset=utf-8'],
      bat: ['script.bat', 'text/plain;charset=utf-8'],
      cmd: ['script.cmd', 'text/plain;charset=utf-8'],
      ini: ['config.ini', 'text/plain;charset=utf-8'],
      conf: ['config.conf', 'text/plain;charset=utf-8'],
      toml: ['config.toml', 'text/plain;charset=utf-8'],
      env: ['.env.example', 'text/plain;charset=utf-8'],
      xml: ['document.xml', 'application/xml;charset=utf-8'],
      svg: ['image.svg', 'image/svg+xml;charset=utf-8'],
      diff: ['changes.diff', 'text/plain;charset=utf-8'],
      patch: ['changes.patch', 'text/plain;charset=utf-8'],
      graphql: ['schema.graphql', 'text/plain;charset=utf-8'],
      proto: ['service.proto', 'text/plain;charset=utf-8'],
      prisma: ['schema.prisma', 'text/plain;charset=utf-8'],
      vue: ['App.vue', 'text/plain;charset=utf-8'],
      svelte: ['App.svelte', 'text/plain;charset=utf-8'],
      astro: ['App.astro', 'text/plain;charset=utf-8'],
      dockerfile: ['Dockerfile', 'text/plain;charset=utf-8'],
      makefile: ['Makefile', 'text/plain;charset=utf-8'],
      verilog: ['module.v', 'text/plain;charset=utf-8'],
      vhdl: ['module.vhd', 'text/plain;charset=utf-8'],
      asm: ['main.asm', 'text/plain;charset=utf-8'],
      text: ['code.txt', 'text/plain;charset=utf-8'],
      plaintext: ['code.txt', 'text/plain;charset=utf-8']
    };
    const info = known[key] || ['code.txt', 'text/plain;charset=utf-8'];
    const dot = info[0].lastIndexOf('.');
    return { filename: info[0], mime: info[1], extension: dot >= 0 ? info[0].slice(dot) : '' };
  }

  function openSaveMenu(p) {
    const hasCodeSource = Object.prototype.hasOwnProperty.call(p, 'lang');
    const sourceInfo = hasCodeSource ? codeDownloadInfo(p.lang) : null;
    const rawBase = sourceInfo ? sourceInfo.filename.replace(/\.[^.]+$/, '') : (p.title || 'chatstudio');
    const base = rawBase.replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim().slice(0, 40) || 'chatstudio';
    const items = sourceInfo ? [{
      id: 'source',
      label: 'Скачать ' + sourceInfo.filename,
      hint: sourceInfo.extension ? 'Исходный код · ' + sourceInfo.extension : 'Исходный файл',
      primary: true
    }] : [];
    items.push(
      { id: 'txt', label: 'TXT', hint: 'обычный текст' },
      { id: 'md', label: 'Markdown', hint: '.md' },
      { id: 'docx', label: 'DOCX', hint: 'Word' },
      { id: 'pdf', label: 'PDF', hint: 'через печать' }
    );
    if (p.svg) items.push({ id: 'svg', label: 'SVG', hint: 'вектор' });
    openModal({
      title: 'Сохранить как',
      okText: 'Закрыть',
      body: '<div class="fmt-grid">' + items.map((it) =>
        '<button class="fmt-btn' + (it.primary ? ' fmt-btn-primary' : '') + '" data-fmt="' + it.id + '"><b>' + it.label + '</b><span>' +
        it.hint + '</span></button>').join('') + '</div>',
      onOk: () => true,
    });
    $$('[data-fmt]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.fmt;
      const text = p.text || '';
      try {
        if (f === 'source' && sourceInfo) downloadBlob(sourceInfo.filename, new Blob([text], { type: sourceInfo.mime }));
        else if (f === 'txt') downloadBlob(base + '.txt', new Blob([text], { type: 'text/plain;charset=utf-8' }));
        else if (f === 'md') downloadBlob(base + '.md', new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        else if (f === 'docx') downloadBlob(base + '.docx', textToDocx(text));
        else if (f === 'pdf') printPdf(p.title || 'AI CH', p.html || ('<pre>' + escapeHtml(text) + '</pre>'));
        else if (f === 'svg' && p.svg) downloadBlob(base + '.svg', new Blob([p.svg], { type: 'image/svg+xml' }));
        $('#modal-root').innerHTML = '';
        toast('Файл сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }
  function openTableMenu(rows) {
    openModal({
      title: 'Скачать таблицу',
      okText: 'Закрыть',
      body: '<div class="fmt-grid">' +
        '<button class="fmt-btn" data-tf="xlsx"><b>XLSX</b><span>Excel</span></button>' +
        '<button class="fmt-btn" data-tf="ods"><b>ODS</b><span>LibreOffice</span></button>' +
        '<button class="fmt-btn" data-tf="csv"><b>CSV</b><span>текст</span></button>' +
        '<button class="fmt-btn" data-tf="pdf"><b>PDF</b><span>печать</span></button>' +
        '</div>',
      onOk: () => true,
    });
    $$('[data-tf]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.tf;
      try {
        if (f === 'xlsx') downloadBlob('table.xlsx', rowsToXlsx(rows));
        else if (f === 'ods') downloadBlob('table.ods', rowsToOds(rows));
        else if (f === 'csv') downloadBlob('table.csv', new Blob(
          [rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')],
          { type: 'text/csv;charset=utf-8' }));
        else if (f === 'pdf') printPdf('Таблица', '<table><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>');
        $('#modal-root').innerHTML = '';
        toast('Файл сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  // ---------- memory ----------
  async function loadMemory() {
    try {
      const items = await api.get('/api/memory');
      state.memories = items;
      const counts = document.querySelectorAll('.mem-count');
      counts.forEach((el) => { el.textContent = items.length ? String(items.length) : ''; });
    } catch (e) { state.memories = []; }
  }

  async function openCouncil() {
    let models = [];
    try { models = await api.get('/api/council/models'); } catch (e) { models = []; }
    if (models.length < 2) {
      toast('Совет недоступен', 'error');
      return;
    }
    openModal({
      title: 'Совет моделей · бета',
      okText: 'Запустить',
      body: '<p class="usage-note">Все участники отвечают <b>в этом же чате</b> и параллельно. ' +
        'Переключай ответы стрелками ‹ › под сообщением — последний вариант «Совет» ' +
        'сводит их в один общий ответ.</p>' +
        '<textarea id="council-q" rows="3" placeholder="Ваш вопрос для совета..."></textarea>' +
        '<div class="council-models">' + models.map((m, i) =>
          '<label class="council-row"><input type="checkbox" data-ms="' + m.id + '"' +
          (i < 3 ? ' checked' : '') + '/><span><b>' + escapeHtml(m.name) + '</b>' +
          (m.hint ? '<em>' + escapeHtml(m.hint) + '</em>' : '') + '</span></label>').join('') +
        '</div>',
      onOk: async (root) => {
        const q = ($('#council-q', root) || {}).value ? $('#council-q', root).value.trim() : '';
        if (!q) { toast('Введите вопрос', 'error'); return false; }
        const ids = $$('[data-ms]', root).filter(c => c.checked).map(c => c.dataset.ms);
        if (ids.length < 1) { toast('Выберите хотя бы одного участника', 'error'); return false; }
        try {
          const res = await api.post('/api/council', { question: q, personas: ids, model_set_id: state.modelSetId || null });
          await loadChats();
          await openChat(res.merge_chat_id);
          toast('Совет запущен: ' + ids.length + ' участников');
          return true;
        } catch (e) {
          toast('Ошибка: ' + e.message, 'error');
          return false;
        }
      },
    });
  }

  const connectorHelpUrls = {
    github: 'https://github.com/settings/tokens',
    youtube: 'https://console.cloud.google.com/apis/credentials',
    spotify: 'https://developer.spotify.com/dashboard',
    gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    notion: 'https://www.notion.so/profile/integrations',
    slack: 'https://api.slack.com/apps',
    google_drive: 'https://console.cloud.google.com/apis/credentials',
    linear: 'https://linear.app/settings/api',
    huggingface: 'https://huggingface.co/settings/tokens',
    discord: 'https://discord.com/developers/applications'
  };

  async function renderConnectorsInto(container) {
    if (!container) return;
    container.innerHTML = '<p class="usage-note">Загружаю список коннекторов…</p>';
    try {
      const payload = await api.get('/api/connectors');
      const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
      container.innerHTML =
        '<div class="connector-catalog-intro"><strong>Подключения к внешним сервисам</strong>' +
        '<p>Токены хранятся на сервере аккаунта и не показываются в интерфейсе после сохранения. Доступные действия ограничены правами самого токена.</p>' +
        '<p class="usage-note">Лимит действий агента в одном запросе: <b>' + Number(payload.action_limit || 3) +
        '</b> для текущего тарифа.</p></div>' +
        '<div class="connector-catalog">' + catalog.map(item => {
          const provider = String(item.provider || '');
          const connected = !!item.connected;
          const actions = Array.isArray(item.actions) ? item.actions : [];
          const help = connectorHelpUrls[provider] || '';
          return '<article class="connector-card" data-provider="' + escapeHtml(provider) + '">' +
            '<div class="connector-card-head"><strong>' + escapeHtml(item.title || provider) + '</strong>' +
            '<span class="connector-status ' + (connected ? 'is-connected' : '') + '">' +
            (connected ? 'Подключён' : 'Не подключён') + '</span></div>' +
            '<p>' + escapeHtml(item.description || '') + '</p>' +
            '<div class="connector-actions-list">Действия: ' + escapeHtml(actions.join(' · ')) + '</div>' +
            '<div class="connector-card-controls">' +
            '<button type="button" class="chip-btn" data-connector-config="' + escapeHtml(provider) + '">' +
            (connected ? 'Заменить токен' : 'Подключить') + '</button>' +
            (connected ? '<button type="button" class="chip-btn connector-disconnect" data-connector-disconnect="' + escapeHtml(provider) + '">Отключить</button>' : '') +
            (help ? '<a class="connector-help-link" href="' + escapeHtml(help) + '" target="_blank" rel="noopener noreferrer">Получить токен ↗</a>' : '') +
            '</div></article>';
        }).join('') + '</div>';
      if (container.dataset.connectorBound !== '1') {
        container.dataset.connectorBound = '1';
        container.addEventListener('click', async event => {
          const configButton = event.target.closest('[data-connector-config]');
          const disconnectButton = event.target.closest('[data-connector-disconnect]');
          if (configButton) {
            const provider = configButton.dataset.connectorConfig;
            const item = catalog.find(row => row.provider === provider);
            const help = connectorHelpUrls[provider] || '';
            openModal({
              title: (item && item.title ? item.title : provider) + ' · подключение',
              okText: 'Сохранить и проверить',
              extraClass: 'bottom-sheet connector-token-sheet',
              body: '<p class="usage-note">Вставьте API-токен или ключ, созданный в настройках сервиса. AI CH не может расширить права выданного токена.</p>' +
                '<input id="connector-token-input" type="password" autocomplete="new-password" spellcheck="false" placeholder="API-токен / ключ" />' +
                (help ? '<p class="usage-note"><a href="' + escapeHtml(help) + '" target="_blank" rel="noopener noreferrer">Открыть страницу токенов сервиса ↗</a></p>' : '') +
                '<p class="usage-note">Секрет не будет повторно показан после сохранения.</p>',
              onOk: async root => {
                const tokenInput = $('#connector-token-input', root);
                const token = tokenInput ? tokenInput.value.trim() : '';
                if (!token) { toast('Введите токен или API-ключ', 'error'); return false; }
                await api.put('/api/connectors/' + encodeURIComponent(provider), { token });
                const result = await api.post('/api/connectors/' + encodeURIComponent(provider) + '/test', {});
                if (!result || !result.ok) {
                  try { await api.del('/api/connectors/' + encodeURIComponent(provider)); } catch (rollbackError) { /* server may already have removed it */ }
                  toast('Проверка не пройдена: ' + ((result && result.message) || 'проверьте токен и разрешения') + '. Токен не оставлен подключённым.', 'error');
                  await renderConnectorsInto(container);
                  return false;
                }
                await renderConnectorsInto(container);
                toast('Коннектор ' + ((item && item.title) || provider) + ' подключён');
                return true;
              }
            });
          } else if (disconnectButton) {
            const provider = disconnectButton.dataset.connectorDisconnect;
            const item = catalog.find(row => row.provider === provider);
            if (!confirm('Отключить ' + ((item && item.title) || provider) + '? Сохранённый токен будет удалён.')) return;
            try {
              await api.del('/api/connectors/' + encodeURIComponent(provider));
              await renderConnectorsInto(container);
              toast('Коннектор отключён');
            } catch (error) {
              toast('Не удалось отключить коннектор: ' + error.message, 'error');
            }
          }
        });
      }
    } catch (error) {
      container.innerHTML = '<div class="connectors-empty"><span class="connectors-empty-icon">' + icon('plug') +
        '</span><strong>Не удалось загрузить коннекторы</strong><p>' + escapeHtml(error.message || 'Ошибка сервера') + '</p></div>';
    }
  }

  function openConnectors() {
    openModal({
      title: 'Коннекторы',
      okText: 'Закрыть',
      body: '<div id="connector-settings-modal-list" class="connector-catalog-panel"><p class="usage-note">Загружаю…</p></div>',
      onOk: () => true,
    });
    renderConnectorsInto($('#connector-settings-modal-list'));
  }

  async function openSkills() {
    let payload = { system: [], custom: [] };
    try {
      payload = await api.get('/api/skills');
    } catch (error) {
      toast('Не удалось загрузить навыки: ' + error.message, 'error');
      return;
    }

    let editor = null;
    openModal({
      title: 'Навыки',
      okText: 'Закрыть',
      body: '<div class="skills-manager"><p class="usage-note">Загружаю навыки…</p></div>',
      onOk: () => true,
    });
    const root = $('#modal-root');
    const manager = $('.skills-manager', root);
    if (!manager) return;

    const render = () => {
      const system = Array.isArray(payload.system) ? payload.system : [];
      const custom = Array.isArray(payload.custom) ? payload.custom : [];
      manager.innerHTML =
        '<section class="skills-section"><div class="skills-section-head"><h4 class="sec">Системные навыки</h4>' +
        '<span class="skills-count">' + system.length + '</span></div>' +
        '<p class="usage-note">Содержимое системных навыков скрыто. Здесь доступны только их названия.</p>' +
        '<div class="skills-system-list">' + system.map(skill =>
          '<div class="skills-system-item"><span class="skills-system-icon">' + icon('lock') + '</span>' +
          '<span>' + escapeHtml(skill.title || 'Системный навык') + '</span><span class="skills-system-tag">AI CH</span></div>'
        ).join('') + '</div></section>' +
        '<section class="skills-section"><div class="skills-section-head"><h4 class="sec">Мои навыки</h4>' +
        '<span class="skills-count">' + custom.length + '/30</span></div>' +
        '<p class="usage-note">Ваши инструкции сохраняются в аккаунте и учитываются в ответах AI CH.</p>' +
        (custom.length
          ? '<div class="skills-custom-list">' + custom.map(skill =>
            '<article class="skills-custom-item"><div class="skills-custom-main"><strong>' +
            escapeHtml(skill.title || 'Без названия') + '</strong><p>' +
            escapeHtml(String(skill.content || '').slice(0, 180)) + (String(skill.content || '').length > 180 ? '…' : '') +
            '</p></div><div class="skills-custom-actions">' +
            '<button type="button" class="chip-btn" data-skill-action="edit" data-skill-id="' + escapeHtml(skill.id) + '">' + icon('pencil') + 'Изменить</button>' +
            '<button type="button" class="chip-btn" data-skill-action="delete" data-skill-id="' + escapeHtml(skill.id) + '" aria-label="Удалить навык">' + icon('trash') + '</button>' +
            '</div></article>'
          ).join('') + '</div>'
          : '<div class="skills-empty"><span class="skills-empty-icon">' + icon('book-open') + '</span><strong>Пока нет своих навыков</strong><p>Создайте инструкцию под свой стиль работы.</p></div>') +
        '<button type="button" class="chip-btn skills-add-button" data-skill-action="new" ' + (custom.length >= 30 ? 'disabled' : '') + '>' +
        icon('plus') + 'Добавить свой навык</button></section>' +
        (editor
          ? '<form class="skills-editor" id="skills-editor"><h4 class="sec">' + (editor.id ? 'Изменить навык' : 'Новый навык') + '</h4>' +
            '<label for="skill-editor-title">Название</label><input id="skill-editor-title" maxlength="120" required value="' + escapeHtml(editor.title) + '" placeholder="Например, стиль объяснения математики" />' +
            '<label for="skill-editor-content">Инструкции для AI CH</label><textarea id="skill-editor-content" rows="6" maxlength="5000" required placeholder="Опишите, как ИИ должен выполнять задачи…">' + escapeHtml(editor.content) + '</textarea>' +
            '<div class="skills-editor-actions"><button type="button" class="ghost" data-skill-action="cancel">Отмена</button>' +
            '<button type="button" class="solid" data-skill-action="save">' + (editor.id ? 'Сохранить изменения' : 'Создать навык') + '</button></div></form>'
          : '');
    };
    render();

    root.onclick = async event => {
      if (!manager.isConnected) return;
      const button = event.target.closest('[data-skill-action]');
      if (!button || !manager.contains(button)) return;
      const action = button.dataset.skillAction;
      const skillId = button.dataset.skillId;
      if (action === 'new') {
        editor = { id: '', title: '', content: '' };
        render();
        $('#skill-editor-title', manager)?.focus();
        return;
      }
      if (action === 'cancel') {
        editor = null;
        render();
        return;
      }
      if (action === 'edit') {
        const skill = (payload.custom || []).find(item => String(item.id) === String(skillId));
        if (!skill) return;
        editor = { id: skill.id, title: skill.title || '', content: skill.content || '' };
        render();
        $('#skill-editor-title', manager)?.focus();
        return;
      }
      if (action === 'delete') {
        const skill = (payload.custom || []).find(item => String(item.id) === String(skillId));
        if (!skill || !confirm('Удалить навык «' + skill.title + '»?')) return;
        try {
          await api.del('/api/skills/' + encodeURIComponent(skill.id));
          payload = await api.get('/api/skills');
          toast('Навык удалён');
          render();
        } catch (error) {
          toast('Не удалось удалить навык: ' + error.message, 'error');
        }
        return;
      }
      if (action === 'save') {
        const title = String($('#skill-editor-title', manager)?.value || '').trim();
        const content = String($('#skill-editor-content', manager)?.value || '').trim();
        if (!title || !content) {
          toast('Укажите название и инструкции навыка', 'error');
          return;
        }
        const body = { title, content };
        button.disabled = true;
        try {
          if (editor && editor.id) {
            await api.patch('/api/skills/' + encodeURIComponent(editor.id), body);
            toast('Навык сохранён');
          } else {
            await api.post('/api/skills', body);
            toast('Навык создан');
          }
          payload = await api.get('/api/skills');
          editor = null;
          render();
        } catch (error) {
          toast('Не удалось сохранить навык: ' + error.message, 'error');
          button.disabled = false;
        }
      }
    };
  }

  async function renderAddChatMemoryView() {
    const toggle = $('#add-chat-memory-enabled');
    const status = $('#add-chat-memory-status');
    try {
      const data = await api.get('/api/memory/settings');
      const enabled = data && data.memory_enabled !== false;
      if (toggle) toggle.checked = enabled;
      const label = $('#add-chat-memory-current');
      if (label) label.textContent = enabled ? 'Включена' : 'Выключена';
      if (status) status.textContent = enabled
        ? 'Сохранённые факты и предпочтения доступны AI CH.'
        : 'Персональная память не отправляется модели и новые записи не сохраняются.';
    } catch (error) {
      if (status) status.textContent = 'Не удалось загрузить настройку памяти: ' + (error.message || '');
    }
    if (toggle && toggle.dataset.bound !== '1') {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', async () => {
        const previous = !toggle.checked;
        toggle.disabled = true;
        try {
          const data = await api.put('/api/memory/settings', { memory_enabled: toggle.checked });
          const enabled = !!data.memory_enabled;
          toggle.checked = enabled;
          const label = $('#add-chat-memory-current');
          if (label) label.textContent = enabled ? 'Включена' : 'Выключена';
          if (status) status.textContent = enabled
            ? 'Память включена. Сохранённые сведения снова доступны модели.'
            : 'Выключено: сведения не отправляются модели, новые факты не сохраняются. Записи не удалены.';
          toast(enabled ? 'Память включена' : 'Память выключена');
        } catch (error) {
          toggle.checked = previous;
          if (status) status.textContent = 'Не удалось сохранить настройку.';
          toast('Не удалось сохранить настройку памяти: ' + error.message, 'error');
        } finally { toggle.disabled = false; }
      });
    }
    const manageButton = $('#add-chat-manage-memory');
    if (manageButton && manageButton.dataset.bound !== '1') {
      manageButton.dataset.bound = '1';
      manageButton.addEventListener('click', () => {
        closeAddToChatSheet();
        openMemory();
      });
    }
  }

  async function openMemory(filterMessageId) {
    let items = [];
    let memoryEnabled = true;
    try { items = await api.get('/api/memory'); } catch (e) { items = []; }
    try {
      const settings = await api.get('/api/memory/settings');
      memoryEnabled = settings && settings.memory_enabled !== false;
    } catch (e) { /* Keep the legacy default until settings are available. */ }
    if (filterMessageId) items = items.filter(m => m.message_id === filterMessageId);
    const facts = items.filter(m => (m.kind || 'fact') === 'fact');
    const prefs = items.filter(m => m.kind === 'preference');
    const row = (m) => '<div class="mem-row"><span>' + escapeHtml(m.content) + '</span>' +
      '<button data-del-mem="' + m.id + '" title="Удалить из памяти">' + icon('trash') + '</button></div>';

    openModal({
      title: filterMessageId ? 'Что записано по этому ответу' : 'Память о вас',
      okText: 'Закрыть',
      body:
        (!filterMessageId
          ? '<label class="memory-setting-toggle modal-memory-toggle" for="mem-memory-enabled"><span><strong>Использовать память</strong><small>Выключение останавливает передачу и автосохранение; существующие записи остаются в аккаунте.</small></span><input type="checkbox" id="mem-memory-enabled" ' + (memoryEnabled ? 'checked' : '') + ' /></label><p id="mem-memory-note" class="usage-note" aria-live="polite">' + (memoryEnabled ? 'Память включена.' : 'Память выключена — сведения не отправляются модели.') + '</p>'
          : '') +
        '<h4 class="sec">Предпочтения · учитываются только при включённой памяти</h4>' +
        (prefs.length
          ? '<div class="mem-list">' + prefs.map(row).join('') + '</div>'
          : '<p class="usage-note">Пока нет. Например: «отвечай кратко», «всегда с примерами кода».</p>') +
        '<div style="margin:8px 0 16px"><button class="chip-btn" id="mem-add-pref">' +
        icon('plus') + 'Добавить предпочтение</button></div>' +
        '<h4 class="sec">Факты</h4>' +
        (facts.length
          ? '<div class="mem-list">' + facts.map(row).join('') + '</div>'
          : '<p class="usage-note">Пока пусто.</p>') +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="chip-btn" id="mem-add">' + icon('plus') + 'Добавить факт</button>' +
        (items.length && !filterMessageId
          ? '<button class="chip-btn" id="mem-clear">' + icon('trash') + 'Очистить всё</button>' : '') +
        '</div>',
      onOk: () => true,
    });

    const memoryToggle = $('#mem-memory-enabled');
    if (memoryToggle) memoryToggle.addEventListener('change', async () => {
      const previous = !memoryToggle.checked;
      memoryToggle.disabled = true;
      try {
        const data = await api.put('/api/memory/settings', { memory_enabled: memoryToggle.checked });
        const enabled = !!data.memory_enabled;
        memoryToggle.checked = enabled;
        const note = $('#mem-memory-note');
        if (note) note.textContent = enabled
          ? 'Память включена. Сохранённые факты и предпочтения доступны модели.'
          : 'Память выключена. Сохранённые записи остаются в аккаунте, но не отправляются модели; новые записи не сохраняются автоматически.';
        const quickLabel = $('#add-chat-memory-current');
        if (quickLabel) quickLabel.textContent = enabled ? 'Включена' : 'Выключена';
        toast(enabled ? 'Память включена' : 'Память выключена');
      } catch (error) {
        memoryToggle.checked = previous;
        toast('Не удалось сохранить настройку памяти: ' + error.message, 'error');
      } finally { memoryToggle.disabled = false; }
    });

    $$('[data-del-mem]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api.del('/api/memory/' + b.dataset.delMem);
        $('#modal-root').innerHTML = '';
        await loadMemory();
        openMemory(filterMessageId);
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));

    const addFor = (kind, title) => {
      openModal({
        title,
        okText: 'Сохранить',
        body: '<textarea id="mem-text" rows="3" placeholder="' +
          (kind === 'preference' ? 'Например: отвечай кратко и по делу' : 'Например: меня зовут Тимур') +
          '"></textarea>',
        onOk: async (root) => {
          const val = ($('#mem-text', root) || {}).value ? $('#mem-text', root).value.trim() : '';
          if (!val) return false;
          await api.post('/api/memory', { content: val, kind });
          await loadMemory();
          $('#modal-root').innerHTML = '';
          openMemory();
          toast(kind === 'preference' ? 'Предпочтение сохранено' : 'Факт сохранён');
          return true;
        },
      });
    };
    const addF = $('#mem-add');
    if (addF) addF.addEventListener('click', () => addFor('fact', 'Добавить факт'));
    const addP = $('#mem-add-pref');
    if (addP) addP.addEventListener('click', () => addFor('preference', 'Добавить предпочтение'));

    const clr = $('#mem-clear');
    if (clr) clr.addEventListener('click', async () => {
      if (!confirm('Очистить всю память о вас?')) return;
      try {
        await api.del('/api/memory');
        await loadMemory();
        $('#modal-root').innerHTML = '';
        openMemory();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
  }

  // ---------- code-agent project panel ----------
  function toggleProjectPanel(show) {
    const panel = $('#project-panel');
    if (!panel) return;
    const visible = show === undefined ? panel.classList.contains('hidden') : !!show;
    panel.classList.toggle('hidden', !visible);
    if (visible) loadProject(true);
  }

  async function loadProject(resetLogs) {
    if (!state.currentChatId) return;
    try {
      const data = await api.get('/api/chats/' + state.currentChatId + '/project');
      const files = data.files || [];
      const tree = $('#pp-tree');
      tree.innerHTML = files.length
        ? files.map(f =>
            '<div class="pp-file" title="' + escapeHtml(f.path) + '">' + icon('file') +
            '<span>' + escapeHtml(f.path) + '</span><em>' + formatSize(f.size) + '</em></div>').join('')
        : '<div class="pp-empty">Файлов пока нет — попроси агента создать проект.</div>';
      if (resetLogs) $('#pp-logs').textContent = '';
    } catch (e) { /* noop */ }
  }

  function isCurrentCodeAgent() {
    const chat = state.chats.find(item => item && item.id === state.currentChatId);
    return !!chat && chat.mode === 'code';
  }

  function setProjectStatus(text) {
    const box = $('#pp-logs');
    if (box) box.textContent = String(text || '');
  }

  function appendLog(text) {
    const box = $('#pp-logs');
    if (!box || !text) return;
    box.textContent = (box.textContent + '\n' + text).slice(-20000);
    box.scrollTop = box.scrollHeight;
  }

  // ---------- pick from already uploaded files ----------
  async function openFilePicker() {
    if (!state.files || !state.files.length) {
      toast('Сначала загрузите файлы', 'error');
      return;
    }
    const items = state.files.slice(0, 200);
    openModal({
      title: 'Выбрать из загруженных файлов',
      okText: 'Закрыть',
      body: '<div class="link-list">' + items.map(f =>
        '<div class="link-row"><div class="link-info"><b>' + escapeHtml(f.original_name) + '</b>' +
        '<span>' + escapeHtml(f.kind || 'файл') + ' · ' + formatSize(f.size) + '</span></div>' +
        '<button class="chip-btn" data-att="' + f.id + '">' + icon('plus') + 'Прикрепить</button>' +
        '</div>').join('') + '</div>',
      onOk: () => true,
    });
    $$('[data-att]').forEach(b => b.addEventListener('click', () => {
      const f = state.files.find(x => x.id === b.dataset.att);
      if (f && !state.pendingAttachments.some(x => x.id === f.id)) {
        state.pendingAttachments.push(f);
        renderAttachments();
        toast('Прикреплено: ' + f.original_name);
      }
      closeModal();
    }));
  }

  // ---------- server load ----------
  async function loadSystem() {
    try { state.system = await api.get('/api/system'); }
    catch (e) { /* noop */ }
  }

  function systemRowsHtml() {
    const s = state.system;
    if (!s) return '<p class="usage-note">Загрузка…</p>';
    const row = (label, pct, note) =>
      '<div class="sys-row"><span>' + label + '</span>' +
      '<i><b style="width:' + Math.min(100, Math.max(0, pct)) + '%"></b></i>' +
      '<u>' + pct + '%</u></div>' +
      '<div class="sys-note">' + note + '</div>';
    return row('Процессор', s.cpu, 'load average: ' + s.load.map(v => v.toFixed(2)).join(' · ') +
        ' · ядер: ' + s.cpus) +
      row('Оперативная память', s.ram_pct, 'занято ' + formatSize(s.ram_used) +
        ' из ' + formatSize(s.ram_total)) +
      row('Диск', s.disk_pct, 'занято ' + formatSize(s.disk_used) +
        ' из ' + formatSize(s.disk_total) + ' · свободно ' + formatSize(s.disk_free)) +
      '<p class="usage-note">Квота на пользователя: ' + formatSize(s.quota) +
      '. При нехватке места самые старые файлы удаляются автоматически.</p>';
  }

  // ---------- plan limits ----------
  async function openLimits() {
    let data;
    try { data = await api.get('/api/limits/all'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    const labels = data.labels || {};
    const bytes = { file_size: 1, user_storage: 1 };
    const field = (plan, key, value) => {
      const isBytes = bytes[key];
      const shown = isBytes ? Math.round((value || 0) / (1024 * 1024)) : (value === null ? '' : value);
      return '<label class="lim-field"><span>' + escapeHtml(labels[key] || key) +
        (isBytes ? ' <em>МБ</em>' : '') + '</span>' +
        '<input type="number" data-plan="' + plan + '" data-key="' + key + '" value="' +
        shown + '" step="' + (['budget_usd', 'price'].includes(key) ? 'any' : '1') + '" placeholder="∞" /></label>';
    };
    const modelBoxes = (plan) => {
      const allowed = data.allowed[plan] || [];
      const open = allowed.length === 0;
      return '<div class="lim-models">' + (data.models || []).map(m =>
        '<label class="council-row"><input type="checkbox" data-mplan="' + plan +
        '" data-mid="' + m.id + '"' + (open || allowed.indexOf(m.id) >= 0 ? ' checked' : '') +
        '/><span><b>' + escapeHtml(m.name) + '</b></span></label>').join('') +
        '<p class="usage-note">Ничего не отмечено = разрешены все модели.</p></div>';
    };
    const lf = data.limits.free || {};
    const lp = data.limits.pro || {};
    const allKeys = Array.from(new Set(Object.keys(lf).concat(Object.keys(lp)))).filter(key => key !== 'posts');
    const primaryKeys = ['budget_usd', 'window_hours', 'price'];
    const tableKeys = primaryKeys.filter(key => allKeys.includes(key)).concat(allKeys.filter(key => !primaryKeys.includes(key)));
    const rowFor = (key) => '<tr><td class="lk">' + escapeHtml(labels[key] || key) +
      (bytes[key] ? ' <em>МБ</em>' : '') + '</td>' +
      '<td>' + field('free', key, lf[key]) + '</td>' +
      '<td>' + field('pro', key, lp[key]) + '</td></tr>';
    const block = (plan) =>
      '<div class="lim-plan"><h5>Модели тарифа ' + plan.toUpperCase() + '</h5>' +
      modelBoxes(plan) + '</div>';
    openModal({
      title: 'Тарифы, лимиты и деньги',
      okText: 'Сохранить',
      body: '<p class="usage-note">Бюджет — суммарная стоимость вызовов ИИ за скользящее окно; длина окна задаётся в часах. ' +
        'Цены входных, выходных и кэшированных токенов задаются в моделях MAIN или переменными QWEN_PRICE_IN, ' +
        'QWEN_PRICE_OUT и QWEN_PRICE_CACHE (доллары за 1 млн токенов). Пустой бюджет — без ограничения; ' +
        'размеры указаны в МБ. Прочие лимиты ограничивают файлы, чаты, код-агенты, консилиум, запуск кода и озвучивание.</p>' +
        '<div class="lim-table-scroll"><table class="lim-table"><thead><tr><th>Лимит</th>' +
        '<th>Free<button class="reset-plan" data-reset-plan="free">сбросить</button></th>' +
        '<th>Pro<button class="reset-plan" data-reset-plan="pro">сбросить</button></th>' +
        '</tr></thead>' +
        '<tbody>' + tableKeys.map(rowFor).join('') + '</tbody></table></div>' +
        '<div class="lim-plans">' + (data.plans || ['free', 'pro']).map(block).join('') + '</div>' +
        '<h4 class="sec">Пользователи</h4><div id="lim-users">Загрузка…</div>',
      onOk: async (root) => {
        const grouped = {};
        $$('[data-plan]', root).forEach(inp => {
          const plan = inp.dataset.plan;
          const key = inp.dataset.key;
          const raw = inp.value.trim();
          let val = raw === '' ? null : Number(raw);
          if (val !== null && bytes[key]) val = Math.round(val * 1024 * 1024);
          grouped[plan] = grouped[plan] || {};
          grouped[plan][key] = val;
        });
        for (const plan of Object.keys(grouped)) {
          await api.put('/api/limits/' + plan, grouped[plan]);
        }
        for (const plan of (data.plans || [])) {
          const ids = $$('[data-mplan="' + plan + '"]', root)
            .filter(c => c.checked).map(c => c.dataset.mid);
          const all = (data.models || []).map(m => m.id);
          await api.put('/api/limits/' + plan + '/models',
            { ids: ids.length === all.length ? [] : ids });
        }
        toast('Тарифы сохранены');
        return true;
      },
    });
    $('.modal', $('#modal-root'))?.classList.add('limits-modal');
    loadLimitUsers();
    $$('[data-reset-plan]', $('#modal-root')).forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Сбросить лимиты тарифа ' + b.dataset.resetPlan.toUpperCase() +
                   ' к значениям по умолчанию?')) return;
      try {
        await api.post('/api/limits/' + b.dataset.resetPlan + '/reset', {});
        toast('Лимиты ' + b.dataset.resetPlan.toUpperCase() + ' сброшены');
        const root = $('#modal-root');
        root.innerHTML = '';
        await openLimits();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  async function loadLimitUsers() {
    const box = $('#lim-users');
    if (!box) return;
    let rows = [];
    try { rows = await api.get('/api/limits/users'); } catch (e) { rows = []; }
    box.innerHTML = '<div class="link-list lim-user-list">' + rows.map(u =>
      '<div class="link-row lim-user-row"><div class="link-info"><b>' + escapeHtml(u.name || u.email) + '</b>' +
      '<span>' + escapeHtml(u.email) + ' · ' + (u.plan === 'pro' ? 'Pro' : 'Free') +
      ' · API-баланс: ' + fmtNum(u.token_balance || 0) + ' токенов' +
      ' · вход: ' + fmtNum(u.tokens_in) + ' · выход: ' + fmtNum(u.tokens_out) +
      ' · расход за окно: $' + Number(u.spend_usd || 0).toFixed(4) +
      (u.budget_usd !== null && u.budget_usd !== undefined ? ' / $' + Number(u.budget_usd).toFixed(2) : ' · без денежного лимита') +
      ' за ' + Number(u.window_hours || 5) + ' ч · всего $' + Number(u.cost || 0).toFixed(4) +
      ' · файлы: ' + formatSize(u.storage) + '</span></div>' +
      '<div class="lim-user-actions">' +
      '<button class="chip-btn" data-utopup="' + escapeHtml(u.id) + '">'+icon('plus')+' Токены</button>' +
      '<button class="chip-btn" data-uplan="' + escapeHtml(u.id) + '">' +
      (u.plan === 'pro' ? 'Снять Pro' : 'Выдать Pro') + '</button>' +
      '<button class="chip-btn" data-ureset="' + escapeHtml(u.id) + '" title="Обнулить расход в текущем окне">Сбросить расход</button>' +
      '</div></div>').join('') + '</div>';
    $$('[data-utopup]', box).forEach(b => b.addEventListener('click', () => {
      const u=rows.find(x=>x.id===b.dataset.utopup);if(!u)return;
      openModal({title:'Пополнить API-баланс',okText:'Закрыть',extraClass:'token-topup-modal',
        body:'<div class="token-topup-user"><b>'+escapeHtml(u.name||u.email)+'</b><span>'+escapeHtml(u.email)+'</span><small>Текущий баланс: '+fmtNum(u.token_balance||0)+' токенов</small></div>'+
        '<label class="token-topup-field"><span>Сколько начислить токенов</span><input id="token-topup-amount" type="number" min="1" max="1000000000" step="1" value="30000" required /></label>'+
        '<label class="token-topup-field"><span>Комментарий к операции</span><input id="token-topup-reason" type="text" maxlength="240" value="Пополнение администратором" /></label>'+
        '<button type="button" class="api-primary-action" id="token-topup-save">'+icon('wallet')+' Начислить токены</button>',
        onOk:()=>true});
      $('#token-topup-save')?.addEventListener('click',async e=>{
        const button=e.currentTarget,amount=Number($('#token-topup-amount')?.value);
        const reason=String($('#token-topup-reason')?.value||'Пополнение администратором').trim();
        if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000){toast('Укажите целое число от 1 до 1 000 000 000','error');return;}
        button.disabled=true;
        try{
          const result=await api.post('/api/limits/user/'+encodeURIComponent(u.id)+'/tokens',{amount,reason});
          toast('Баланс пополнен: '+fmtNum(result.token_balance)+' токенов');
          await loadLimitUsers();
        }catch(error){toast('Не удалось пополнить баланс: '+error.message,'error');button.disabled=false;}
      });
    }));
    $$('[data-uplan]', box).forEach(b => b.addEventListener('click', async () => {
      const cur = rows.find(x => x.id === b.dataset.uplan);
      const next = cur && cur.plan === 'pro' ? 'free' : 'pro';
      try {
        await api.put('/api/limits/user/' + encodeURIComponent(b.dataset.uplan), { plan: next });
        toast(next === 'pro' ? 'Подписка Pro выдана' : 'Подписка Pro снята');
        await loadLimitUsers();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
    $$('[data-ureset]', box).forEach(b => b.addEventListener('click', async () => {
      const cur = rows.find(x => x.id === b.dataset.ureset);
      if (!cur || !confirm('Сбросить потраченный бюджет окна для ' + (cur.email || cur.name) + '? История расходов сохранится.')) return;
      try {
        await api.post('/api/limits/user/' + encodeURIComponent(b.dataset.ureset) + '/reset-window', {});
        toast('Расход в окне сброшен');
        await loadLimitUsers();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  // ---------- GitHub for the code agent ----------
  async function openGit() {
    if (!state.currentChatId) { toast('Откройте проект', 'error'); return; }
    let me = { connected: false, login: '' };
    try { me = await api.get('/api/github/me'); } catch (e) { /* noop */ }
    let st = { initialized: false };
    try { st = await api.get('/api/github/chats/' + state.currentChatId + '/status'); }
    catch (e) { /* noop */ }
    openModal({
      title: 'GitHub · ' + (st.initialized ? 'репозиторий готов' : 'не подключён'),
      okText: 'Закрыть',
      body:
        '<h4 class="sec">Аккаунт</h4>' +
        '<div class="lim-grid">' +
        '<label class="lim-field"><span>Логин GitHub</span>' +
        '<input id="gh-login" value="' + escapeHtml(me.login || '') + '" placeholder="username" /></label>' +
        '<label class="lim-field"><span>Токен (repo)</span>' +
        '<input id="gh-token" type="password" placeholder="' +
        (me.connected ? '•••••••• (сохранён)' : 'ghp_...') + '" /></label>' +
        '</div>' +
        '<div class="settings-grid" style="margin-top:10px">' +
        '<button class="chip-btn" id="gh-save">Сохранить доступ</button>' +
        (me.connected ? '<button class="chip-btn danger" id="gh-forget">Отключить</button>' : '') +
        '</div>' +
        '<h4 class="sec">Проект</h4>' +
        '<label class="lim-field"><span>Репозиторий (owner/repo)</span>' +
        '<input id="gh-repo" placeholder="user/my-project" /></label>' +
        '<div class="settings-grid" style="margin-top:10px">' +
        '<button class="chip-btn" id="gh-init">init</button>' +
        '<button class="chip-btn" id="gh-commit">commit</button>' +
        '<button class="chip-btn" id="gh-push">push</button>' +
        '<button class="chip-btn" id="gh-sync">commit + push</button>' +
        '</div>' +
        (st.initialized ? '<p class="usage-note">Ветка: <b>' + escapeHtml(st.branch || '') +
          '</b> · remote: ' + escapeHtml(st.remote || '—') + '<br/>' +
          escapeHtml((st.changes || 'нет изменений').slice(0, 400)) + '</p>' : '') +
        '<pre class="pp-logs" id="gh-log" style="margin-top:10px"></pre>',
      onOk: () => true,
    });
    const log = (t) => { const el = $('#gh-log'); if (el) el.textContent = String(t || '').slice(-4000); };
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('#gh-save', async () => {
      try {
        await api.post('/api/github/me', {
          login: $('#gh-login').value.trim(), token: $('#gh-token').value.trim(),
        });
        toast('Доступ сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    on('#gh-forget', async () => {
      try { await api.del('/api/github/me'); closeModal(); openGit(); }
      catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    ['init', 'commit', 'push', 'sync'].forEach(act => {
      on('#gh-' + act, async () => {
        log('выполняется ' + act + '…');
        try {
          const res = await api.post('/api/github/chats/' + state.currentChatId + '/git', {
            action: act,
            repo: ($('#gh-repo') || {}).value ? $('#gh-repo').value.trim() : '',
            message: 'Update from AI CH',
          });
          log((res.log || '') + (res.ok ? '\n✓ готово' : '\n✗ ошибка'));
          loadProject(false);
        } catch (e) { log('Ошибка: ' + e.message); }
      });
    });
  }

  // ---------- main page: action tiles ----------
  const ACTION_TILES = [
    {
      id: 'essay', label: 'Написать сочинение', icon: 'i-pencil', color: '#f2c14e',
      title: 'Сочинение',
      questions: '**Сочинение.** Ответьте, пожалуйста, на пару вопросов — и я сразу напишу.\n\n' +
        '1. Тема или вопрос сочинения?\n2. Объём (например, 250 слов / 2 страницы)?\n' +
        '3. Класс, курс или аудитория?\n4. Нужны аргументы из литературы или можно своими словами?\n\n' +
        'Можно ответить одной строкой — остальное подберу сам.',
    },
    {
      id: 'doc', label: 'Документ Word', icon: 'i-doc', color: '#2f6fb0',
      title: 'Документ Word',
      questions: '**Документ Word.** Чтобы получилось то, что нужно, уточните:\n\n' +
        '1. Тема и назначение документа?\n2. Какие разделы должны быть?\n' +
        '3. Примерный объём (страниц)?\n4. Нужен ли титульный лист и оглавление?\n5. Стиль оформления (деловой, научный, отчёт)?\n\n' +
        'Ответьте одной строкой — оформлю в лучшем виде.',
    },
    {
      id: 'slides', label: 'Презентация', icon: 'i-slides', color: '#55544f',
      title: 'Презентация',
      questions: '**Презентация.** Расскажите:\n\n' +
        '1. О чём презентация (тема)?\n2. Для кого (школа, инвесторы, коллеги)?\n' +
        '3. Сколько слайдов?\n4. Нужны ли графики и цифры?\n5. Стиль: Apple, Fluent, Glass, Neural, Minimal?\n\n' +
        'Достаточно одной строки.',
    },
    {
      id: 'sheet', label: 'Таблица Excel', icon: 'i-sheet', color: '#2f8f6f',
      title: 'Таблица Excel',
      questions: '**Таблица Excel.** Уточните:\n\n' +
        '1. Какие данные и по какой теме?\n2. Какие колонки нужны?\n' +
        '3. Нужны ли формулы, итоги и графики?\n4. Данные дадите вы или их надо придумать/собрать?\n\n' +
        'Ответьте одной строкой.',
    },
    {
      id: 'code', label: 'Написать код', icon: 'i-terminal', color: '#7c5cbf',
      title: 'Код',
      questions: '**Код.** Что нужно написать?\n\n' +
        '1. Задача и язык (Python, JS, SQL)?\n2. Есть ли входные данные или пример?\n' +
        '3. Нужны ли тесты и комментарии?\n\n' +
        'Если нужен полноценный проект с файлами — опишите задачу, я напишу код и файлы.',
    },
    {
      id: 'draw', label: 'Нарисовать схему', icon: 'i-sparkle', color: '#4b4a46',
      title: 'Схема',
      questions: '**Схема.** Опишите:\n\n' +
        '1. Что изобразить (блок-схема, чертёж, план, диаграмма)?\n' +
        '2. Какие элементы и связи между ними?\n3. Нужны ли размеры и подписи?\n\n' +
        'Нарисую в SVG — можно будет скачать.',
    },
    { id: 'image', label: 'Сделать график', icon: 'i-chart', color: '#0e7c9b', title: 'График',
      questions: '**График.** Какие данные построить? Пришлите числа или опишите, откуда их взять, и укажите тип графика (линия, столбцы, круговая).' },
    { id: 'research', label: 'Найти в интернете', icon: 'i-globe', color: '#3f7a3f', title: 'Поиск',
      questions: '**Поиск.** Что именно найти? Сформулируйте вопрос — я поищу в интернете и дам ответ со ссылками на источники.' },
    { id: 'explain', label: 'Объяснить простыми словами', icon: 'i-brain', color: '#a03f6f', title: 'Объяснение',
      questions: '**Объяснение.** Что объяснить? Напишите тему — объясню простыми словами, с примерами.' },
    { id: 'plan', label: 'Составить план', icon: 'i-file', color: '#4b4a46', title: 'План',
      questions: '**План.** Уточните:\n\n1. План чего (проект, обучение, неделя, статья)?\n2. На какой срок?\n3. Какие есть ограничения по времени и ресурсам?\n\nОтветьте одной строкой — составлю подробный план.' },
    { id: 'translate', label: 'Перевести', icon: 'i-globe-box', color: '#4a5568', title: 'Перевод',
      questions: '**Перевод.** Пришлите текст и укажите язык, на который перевести (и стиль: деловой, литературный, разговорный).' },
  ];

  // inline tile icon paths — drawn directly, so they render everywhere
  const TILE_PATHS = {
    pencil: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/><path d="M7 8h6M7 11h4"/>',
    sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 16l.7 1.8L20.5 18.5l-1.8.7L18 21l-.7-1.8L15.5 18.5l1.8-.7z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 17v-6M12.5 17V8M17 17v-9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    brain: '<path d="M9.6 4.6A2.6 2.6 0 0 0 7 7.2v.4A2.8 2.8 0 0 0 5.3 12.4 2.8 2.8 0 0 0 7 17.1v.3a2.6 2.6 0 0 0 5.2 0V5.9a2.6 2.6 0 0 0-2.6-1.3Z"/><path d="M14.4 4.6A2.6 2.6 0 0 1 17 7.2v.4a2.8 2.8 0 0 1 1.7 4.8A2.8 2.8 0 0 1 17 17.1v.3a2.6 2.6 0 0 1-5.2 0"/><path d="M12 4.6v15"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    link: '<path d="M9.5 14.5l5-5"/><path d="M11 7l1.5-1.5a3.5 3.5 0 1 1 5 5L16 12M13 17l-1.5 1.5a3.5 3.5 0 1 1-5-5L8 12"/>',
  };

  // maps old sprite ids (and bare names) onto the inline set
  const TILE_ALIAS = {
    'i-pencil': 'pencil', 'i-doc': 'doc', 'i-slides': 'slides', 'i-sheet': 'sheet',
    'i-terminal': 'terminal', 'i-sparkle': 'sparkle', 'i-chart': 'chart',
    'i-globe': 'globe', 'i-globe-box': 'globe', 'i-brain': 'brain',
    'i-file': 'file', 'i-link': 'link', 'i-search': 'globe',
  };

  function tileIcon(name) {
    const key = TILE_ALIAS[name] || name;
    const path = TILE_PATHS[key] || TILE_PATHS.sparkle;
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ffffff" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }

  function tileHtml(t) {
    return '<span class="tile' + (t.locked ? ' locked' : '') + '"' +
      ' aria-hidden="true" title="' + escapeHtml(t.label) + '"' +
      ' style="--tile:' + t.color + '">' +
      '<span class="tile-ico">' + tileIcon(t.icon) + '</span>' +
      '<span class="tile-label">' + escapeHtml(t.label) + '</span>' +
      (t.locked ? '<span class="tile-lock">' + icon('lock') + '</span>' : '') + '</span>';
  }

  function renderTiles() {
    const box = $('#tiles');
    if (!box) return;
    const sequence = ACTION_TILES.map(tileHtml).join('');
    // Duplicate artwork only to make the moving row loop smoothly; no icon is a button.
    box.innerHTML = '<div class="tile-track">' +
      '<div class="tile-sequence">' + sequence + '</div>' +
      '<div class="tile-sequence" aria-hidden="true">' + sequence + '</div>' +
      '</div>';
  }


  function bindTiles() {
    $$('[data-tile]').forEach(b => b.addEventListener('click', () => {
      const t = ACTION_TILES.find(x => x.id === b.dataset.tile);
      if (!t) return;
      if (t.locked) {
        toast('«' + t.label + '» появится в ближайшем обновлении — уже пишем', 'error');
        return;
      }
      useTile(t);
    }));
  }

  async function useTile(t) {
    if (state.chatCreating) return;
    setChatCreationPending(true);
    const selectionToken = state.chatOpenToken;
    let chat = null;
    try {
      chat = await api.post('/api/chats', { title: t.title || t.label });
      if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !chat.id) {
        throw new Error('Сервер не вернул созданный чат с корректным ID');
      }
      upsertChat(chat);
      if (selectionToken === state.chatOpenToken) {
        await openChat(chat.id);
      } else {
        renderChatList();
      }

      if (t.questions) {
        await api.post('/api/chats/' + encodeURIComponent(chat.id) + '/seed', { text: t.questions });
        const loadedTree = await api.get('/api/chats/' + encodeURIComponent(chat.id) + '/messages');
        // A late seed response must not replace a different chat selected in the meantime.
        if (state.currentChatId === chat.id) {
          state.tree = Array.isArray(loadedTree) ? loadedTree : [];
          renderMessages();
          toast('Ответьте на вопросы — и я приступлю');
        }
      }
      if (state.currentChatId === chat.id) $('#input').focus();
    } catch (e) {
      toast('Ошибка: ' + (e.message || e), 'error');
      if (chat) renderChatList();
    } finally {
      setChatCreationPending(false);
    }
  }

  function rotateTiles() {
    const box = $('#tiles');
    if (!box) return;
    box.classList.add('swap');
    setTimeout(() => {
      renderTiles();
      bindTiles();
      box.classList.remove('swap');
    }, 420);
  }

  // ---------- model choice ----------
  // There is no model picker: the backend uses one primary MAIN model for every AI task.
  function currentModelSet() {
    return null;
  }

  function updateModelButton() {
    // no model button in the composer anymore
  }

  function rollPlaceholder() {
    const el = $('#input');
    if (el) el.placeholder = 'Введите запрос…';
  }

// ---------- subscription limits window ----------
  function limitValueLabel(key, value) {
    if ((value === null || value === undefined) && key === 'price') return 'не задана';
    if (value === null || value === undefined) return 'без лимита';
    if (key === 'user_storage' || key === 'file_size') return formatSize(value);
    return fmtNum(value);
  }

  function planCompareHtml(lim, compare) {
    const pro = (compare && compare.pro) || {};
    const order = ['budget_usd', 'window_hours', 'price', 'audio_generations', 'file_size', 'user_storage', 'files_count',
                   'chats_count', 'code_agents', 'agent_steps', 'agent_actions', 'council_members', 'sandbox_seconds'];
    const labels = {
      budget_usd: 'Бюджет на окно, $',
      window_hours: 'Окно, часов',
      price: 'Цена тарифа, $/мес',
      audio_generations: 'Голосовых ответов за окно',
      file_size: 'Размер файла',
      user_storage: 'Хранилище',
      files_count: 'Файлов всего',
      chats_count: 'Чатов всего',
      code_agents: 'Код-агентов',
      agent_steps: 'Шагов агента',
      agent_actions: 'Действий агента за запрос',
      council_members: 'Участников консилиума',
      sandbox_seconds: 'Секунд на код',
    };

    // Keep the rows as an array until after splitting it into two columns.
    const rowList = order.filter(k => lim[k] !== undefined || pro[k] !== undefined).map(k => {
      const mine = lim[k];
      const theirs = pro[k];
      let mult = '—';
      if (theirs === null || theirs === undefined) mult = '∞';
      else if (mine === null || mine === undefined) mult = '=';
      else if (Number(mine) > 0) {
        const m = Number(theirs) / Number(mine);
        mult = m >= 1.05 ? '×' + (Math.round(m * 10) / 10) : '=';
      }
      return '<tr><td>' + escapeHtml(labels[k] || k) + '</td>' +
        '<td>' + limitValueLabel(k, mine) + '</td>' +
        '<td class="pro-col">' + limitValueLabel(k, theirs) + '</td>' +
        '<td class="mult">' + mult + '</td></tr>';
    });
    const half = Math.ceil(rowList.length / 2);
    const head = '<thead><tr><th>Лимит</th><th>Сейчас</th><th>С подпиской</th><th>×</th></tr></thead>';
    return '<div class="cmp-cols">' +
      '<table class="cmp">' + head + '<tbody>' + rowList.slice(0, half).join('') + '</tbody></table>' +
      '<table class="cmp">' + head + '<tbody>' + rowList.slice(half).join('') + '</tbody></table>' +
      '</div>';
  }

  let subscriptionModalOpening = false;
  async function openUsageModal(options) {
    const exhausted = !!(options && options.exhausted);
    // SSE and the catch path may report the same depleted budget.
    // Set the guard before await so the dialog can only be mounted once.
    if ($('.modal.subscription-usage-modal', $('#modal-root'))) return;
    if (subscriptionModalOpening) return;
    subscriptionModalOpening = true;
    try {
      // Never keep the subscription dialog hidden behind a slow limits request.
      // Give fresh data a short head start, then render with cached data or a clear notice.
      let limitsLoadError = false;
      if ((options && options.refresh) || !state.limits) {
        const cachedLimits = state.limits;
        const loading = loadLimits();
        let loadingWaitTimer = null;
        const result = await Promise.race([
          loading,
          new Promise(resolve => {
            loadingWaitTimer = setTimeout(() => resolve({ timedOut: true }), 1500);
          }),
        ]);
        if (loadingWaitTimer) clearTimeout(loadingWaitTimer);
        if (result && result.timedOut) {
          limitsLoadError = true;
          if (cachedLimits) state.limits = cachedLimits;
        } else if (result instanceof Error) {
          limitsLoadError = true;
          if (cachedLimits) state.limits = cachedLimits;
        }
      }
      if ($('.modal.subscription-usage-modal', $('#modal-root'))) return;
    const data = state.limits || {};
    const lim = data.limits || {};
    const limitsUnavailable = limitsLoadError && !state.limits;
    const limitsLoadNotice = limitsLoadError
      ? '<section class="usage-note" role="status">' +
        (limitsUnavailable
          ? 'Не удалось загрузить показатели лимитов. Окно подписки открыто; повторите открытие окна позже, чтобы обновить данные.'
          : 'Не удалось обновить показатели лимитов. Показаны последние загруженные данные.') +
        '</section>'
      : '';
    const pro = (data.compare && data.compare.pro) || {};
    const plan = data.plan || 'free';
    const w = data.window || null;
    const use = data.usage || {};
    const free = (data.compare && data.compare.free) || {};
    const proPrice = Number(pro.price || 0);
    const windowHours = Number(w && w.hours || lim.window_hours || 5);
    const moneyDetail = pro.budget_usd == null ? 'без денежного лимита'
      : (free.budget_usd != null
        ? '$' + Number(pro.budget_usd).toFixed(2) + ' вместо $' + Number(free.budget_usd).toFixed(2) + ' за ' + windowHours + ' ч'
        : '$' + Number(pro.budget_usd).toFixed(2) + ' за ' + windowHours + ' ч');
    const benefitRows = [
      ['wallet', 'Бюджет на ИИ', moneyDetail],
      ['file-text', 'Размер файла', limitValueLabel('file_size', pro.file_size) + ' на файл' + (free.file_size !== undefined ? ' вместо ' + limitValueLabel('file_size', free.file_size) : '')],
      ['database', 'Хранилище', limitValueLabel('user_storage', pro.user_storage) + (free.user_storage !== undefined ? ' вместо ' + limitValueLabel('user_storage', free.user_storage) : '')],
      ['terminal', 'Время выполнения кода', limitValueLabel('sandbox_seconds', pro.sandbox_seconds) + ' с на запуск' + (free.sandbox_seconds !== undefined ? ' вместо ' + limitValueLabel('sandbox_seconds', free.sandbox_seconds) + ' с' : '')],
    ];
    const proBenefitsHtml = limitsUnavailable
      ? '<p class="usage-note">Преимущества тарифа временно недоступны: не удалось загрузить настройки лимитов.</p>'
      : '<div class="sub-benefits-grid">' + benefitRows.map(item =>
        '<div class="sub-benefit-card"><span class="sub-benefit-icon">' + icon(item[0]) + '</span>' +
        '<span class="sub-benefit-copy"><b>' + escapeHtml(item[1]) + '</b><small>' + escapeHtml(item[2]) + '</small></span></div>'
      ).join('') + '</div>';
    const exhaustedNotice = exhausted
      ? '<section class="limit-exhausted-banner" role="status"><span class="limit-exhausted-icon">' +
        icon('gauge') + '</span><div><strong>Лимит запросов на текущем тарифе исчерпан</strong><p>' +
        escapeHtml(
          (w && w.budget_usd !== null && w.budget_usd !== undefined
            ? 'Израсходовано $' + Number(w.spend_usd || 0).toFixed(2) + ' из $' + Number(w.budget_usd).toFixed(2) + '. '
            : '') +
          'Запрос не был отправлен. ' +
          (w && w.hours
            ? 'Новые запросы снова станут доступны, когда расходы старше ' + w.hours + ' ч выйдут из скользящего окна.'
            : 'Повторите попытку позже или оформите Pro.')
        ) + '</p></div></section>'
      : '';

    let money = '';
    if (w && w.budget_usd !== null && w.budget_usd !== undefined) {
      const left = Math.max(0, Number(w.budget_usd) - Number(w.spend_usd));
      const pct = Math.min(100, Math.round(w.percent));
      money = '<div class="lim-row ' + (pct >= 80 ? 'warn' : '') + '">' +
        '<div class="lr-top"><b>Деньги за ' + w.hours + ' ч</b>' +
        '<i>$' + Number(w.spend_usd).toFixed(2) + ' из $' + Number(w.budget_usd).toFixed(2) +
        ' · осталось $' + left.toFixed(2) + ' (' + (100 - pct) + '%)</i></div>' +
        '<div class="lr-bar"><i style="width:' + pct + '%"></i></div></div>';
    }

    const defs = [
      ['files', 'files_count', 'Файлы'],
      ['storage', 'user_storage', 'Хранилище'],
    ];
    const rows = defs.map(d => {
      const used = Number(use[d[0]] || 0);
      const cap = lim[d[1]];
      const unlimited = cap === null || cap === undefined;
      const pct = unlimited ? 0 : Math.min(100, Math.round(used / cap * 100));
      const right = unlimited
        ? limitValueLabel(d[1], used) + ' · без лимита'
        : limitValueLabel(d[1], used) + ' из ' + limitValueLabel(d[1], cap) +
          ' · осталось ' + limitValueLabel(d[1], Math.max(0, cap - used));
      return '<div class="lim-row ' + (unlimited ? 'unlimited' : (pct >= 80 ? 'warn' : '')) + '">' +
        '<div class="lr-top"><b>' + d[2] + '</b><i>' + right + ' · ' +
        (unlimited ? '∞' : pct + '%') + '</i></div>' +
        '<div class="lr-bar"><i style="width:' + (unlimited ? 100 : pct) + '%"></i></div></div>';
    }).join('');

    const audioUsed = Number(w && w.audio_generations || 0);
    const audioCap = w && w.audio_limit !== undefined ? w.audio_limit : lim.audio_generations;
    const audioUnlimited = audioCap === null || audioCap === undefined;
    const audioHours = Number(w && w.hours || lim.window_hours || 5);
    const audioPct = audioUnlimited ? 0 : Math.min(100, Math.round(audioUsed / Math.max(1, Number(audioCap)) * 100));
    const audioRight = audioUnlimited
      ? audioUsed + ' · без лимита'
      : audioUsed + ' из ' + audioCap + ' за ' + audioHours + ' ч · осталось ' + Math.max(0, Number(audioCap) - audioUsed);
    const audioRow = '<div class="lim-row ' + (audioUnlimited ? 'unlimited' : (audioPct >= 80 ? 'warn' : '')) + '">' +
      '<div class="lr-top"><b>Голосовые ответы</b><i>' + audioRight + ' · ' +
      (audioUnlimited ? '∞' : audioPct + '%') + '</i></div>' +
      '<div class="lr-bar"><i style="width:' + (audioUnlimited ? 100 : audioPct) + '%"></i></div></div>';

    openModal({
      title: exhausted ? 'Лимит запросов исчерпан' : 'Лимиты подписки',
      okText: exhausted ? 'Закрыть' : 'Понятно',
      body: limitsLoadNotice + exhaustedNotice +
        '<section class="sub-hero"><div class="sub-hero-top"><span class="sub-plan-mark">' + icon('shield-check') + '</span>' +
          '<div><div class="sub-eyebrow">ТЕКУЩИЙ ТАРИФ</div><div class="sub-plan">AI-Ch ' + escapeHtml(String(plan).toUpperCase()) + '</div></div>' +
          '<span class="sub-current-pill">' + (exhausted ? 'Лимит исчерпан' : 'Активен') + '</span></div>' +
          '<p>Бюджет считается по стоимости реальных вызовов модели и служебных запросов. ' +
          (w && w.hours ? 'Окно расходов — последние ' + w.hours + ' часов (скользящее).' : 'Окно расхода указано ниже.') + '</p>' +
          '<div class="sub-plan-summary"><span><b>Free</b><small>базовые лимиты</small></span><span class="sub-plan-summary-divider"></span>' +
          '<span><b>Pro</b><small>' + (limitsUnavailable ? 'условия временно недоступны' : (proPrice > 0 ? '$' + proPrice.toFixed(2) + ' / месяц' : 'цена не задана')) + '</small></span></div>' +
          '<div class="sub-keep-chatting-art" aria-label="Иллюстрация возможностей тарифа Pro">' +
            '<svg class="sub-keep-chatting-art-svg" viewBox="0 0 360 132" role="img" aria-hidden="true">' +
              '<rect x="2" y="2" width="356" height="128" rx="15" fill="var(--bg)" stroke="var(--border-soft)"/>' +
              '<rect x="18" y="24" width="118" height="72" rx="14" fill="var(--bg-panel)" stroke="currentColor" stroke-opacity=".42" stroke-width="1.6"/>' +
              '<path d="M42 45h68M42 57h50M42 69h39" fill="none" stroke="currentColor" stroke-opacity=".72" stroke-width="3" stroke-linecap="round"/>' +
              '<circle cx="115" cy="87" r="11" fill="var(--bg-panel)" stroke="var(--keep-chatting-accent, #C77D52)" stroke-width="1.7"/>' +
              '<path d="m110 87 3 3 6-7" fill="none" stroke="var(--keep-chatting-accent, #C77D52)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M151 61h31m-7-7 7 7-7 7" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<rect x="199" y="76" width="18" height="30" rx="4" fill="var(--keep-chatting-accent, #C77D52)" fill-opacity=".22" stroke="var(--keep-chatting-accent, #C77D52)" stroke-opacity=".72"/>' +
              '<rect x="226" y="61" width="18" height="45" rx="4" fill="var(--keep-chatting-accent, #C77D52)" fill-opacity=".36" stroke="var(--keep-chatting-accent, #C77D52)" stroke-opacity=".72"/>' +
              '<rect x="253" y="43" width="18" height="63" rx="4" fill="var(--keep-chatting-accent, #C77D52)" fill-opacity=".56" stroke="var(--keep-chatting-accent, #C77D52)" stroke-opacity=".72"/>' +
              '<path d="m199 56 28-12 25 5 27-22m-11 0h11v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="m315 73 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="var(--keep-chatting-accent, #C77D52)" fill-opacity=".28" stroke="var(--keep-chatting-accent, #C77D52)" stroke-width="1.4" stroke-linejoin="round"/>' +
              '<circle cx="310" cy="28" r="3" fill="var(--keep-chatting-accent, #C77D52)"/><circle cx="336" cy="51" r="2" fill="currentColor" fill-opacity=".45"/>' +
            '</svg>' +
            '<div class="sub-keep-chatting-copy"><strong>Продолжай работу над идеей</strong>' +
              '<span><i class="sub-keep-chatting-dot"></i>Сравни актуальные лимиты Free и Pro ниже</span></div>' +
          '</div>' +
          '<h4 class="sub-benefits-heading">Что даёт Pro</h4>' + proBenefitsHtml +
          '<button type="button" class="sub-upgrade-button" id="copy-pro-request">' + icon('sparkle') +
          '<span><b>Запросить оформление Pro</b><small>Скопировать сообщение администратору</small></span>' + icon('arrow-right') +
          '</button></section><section class="sub-usage-section"><h4 class="sec">Текущее использование</h4>' +
          '<p class="usage-note">Окно скользящее: учитываются расходы за последние ' +
          escapeHtml(String(w && w.hours || lim.window_hours || 5)) +
          ' часов, а не с начала календарного дня. Когда старые расходы выходят из окна, они перестают учитываться.</p>' +
          (limitsUnavailable
            ? '<p class="usage-note">Текущие показатели использования скрыты, чтобы не показывать неподтверждённые значения.</p>'
            : money + rows + audioRow) +
          '</section><section class="sub-comparison-section"><h4 class="sec">Лимиты Free и Pro</h4>' +
          (limitsUnavailable
            ? '<p class="usage-note">Сравнение тарифов временно недоступно.</p>'
            : planCompareHtml(lim, data.compare)) + '</section>' +
          '<p class="usage-note sub-admin-note">Автоматическая оплата не подключена. Запрос можно отправить администратору.</p>',
      onOk: () => true,
    });
    const subscriptionModal = $('.modal', $('#modal-root'));
    if (subscriptionModal) {
      subscriptionModal.classList.add('subscription-usage-modal');
      if (exhausted) subscriptionModal.classList.add('is-limit-exhausted');
    }
    const copyProRequest = $('#copy-pro-request');
    if (copyProRequest) copyProRequest.addEventListener('click', async () => {
      const ok = await copyText('Здравствуйте! Хочу оформить подписку Pro в AI-Ch. Подскажите, пожалуйста, стоимость и порядок оформления.');
      toast(ok ? 'Запрос на оформление Pro скопирован' : 'Не удалось скопировать запрос', ok ? '' : 'error');
    });
    } catch (e) {
      console.error('Could not open subscription limits dialog:', e);
      toast('Не удалось открыть лимиты подписки. Попробуйте ещё раз.', 'error');
    } finally {
      subscriptionModalOpening = false;
    }
  }

  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();

    // Render the empty welcome workspace before background requests begin.
    const welcomeRenderedEarly = !state.currentChatId && allMessages(state.tree).length === 0;
    if (welcomeRenderedEarly) renderMessages();

    if (state.user && state.user.is_admin) {
      const legacyLimitsButton = $('#sidebar-limits-btn');
      if (legacyLimitsButton) legacyLimitsButton.classList.remove('hidden');
      if (!state.systemPollTimer) {
        state.systemPollTimer = window.setInterval(() => { loadSystem().catch(() => {}); }, 20000);
      }
      loadSystem().catch(() => {});
    }
    $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    await Promise.allSettled([
      loadChats(), loadFiles(), loadModelSets(), loadMemory(), loadLimits(), loadUsage(),
    ]);
    if (!welcomeRenderedEarly) renderMessages();
  }

  async function requestGuestSession() {
    const response = await fetch('/api/auth/guest', { method: 'POST', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.user) {
      throw new Error((payload && payload.detail) || ('HTTP ' + response.status));
    }
    window.__csrf = payload.csrf_token || '';
    return payload;
  }

  async function init() {
    bindAuth(); bindSidebar(); bindComposer(); bindFiles(); bindFilesWorkspace(); bindProjectsWorkspace(); bindScheduledWorkspace(); bindAudioPlayer(); bindDeviceSpeechPlayer(); bindDeviceCodeRunner();
    const token = new URLSearchParams(location.search).get('share');
    if (token) { await showPublicView(token); return; }

    // Show the working screen synchronously; resolve identity and history behind it.
    showApp();
    if (!state.currentChatId && allMessages(state.tree).length === 0) renderMessages();
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (response.ok) {
        state.user = await response.json();
      } else {
        const guest = await requestGuestSession();
        state.user = guest.user;
      }
      state.identityReady = true;
      updateAuthCta();
      await boot();
    } catch (e) {
      // Preserve the visible workspace during transient network failures.
      updateAuthCta();
      console.warn('AI CH session initialization failed:', e);
    }
  }

  function syncAppViewportHeight() {
    const viewport = window.visualViewport;
    const h = viewport && viewport.height ? viewport.height : window.innerHeight;
    const top = viewport && Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0;
    document.documentElement.style.setProperty('--app-height', Math.round(h) + 'px');
    document.documentElement.style.setProperty('--app-offset-top', Math.round(top) + 'px');
  }
  syncAppViewportHeight();
  window.addEventListener('resize', syncAppViewportHeight, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppViewportHeight, { passive: true });
    window.visualViewport.addEventListener('scroll', syncAppViewportHeight, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', init);

  // KaTeX loads with defer: re-render math once it is available
  window.addEventListener('load', () => {
    const box = document.getElementById('messages');
    if (box) renderMath(box.querySelector('.msg-wrap'));
  });
})();