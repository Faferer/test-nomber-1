/**
 * app.js — Главный модуль координации.
 * Связывает TextParser, CircleRenderer, PathEditor, ExportManager.
 */

const App = (() => {

    let _canvases = [];   // Текущие сгенерированные canvas
    let _excludePath = null;  // Текущий путь вырезания

    function init() {
        // Инициализация PathEditor
        PathEditor.init(onPathChanged);

        // Кнопка «Очистить» для пути
        document.querySelector('[data-tab="path-clear"]').addEventListener('click', () => {
            PathEditor.clear();
        });

        // Слайдеры: обновляем отображаемое значение
        _bindSlider('circleSize', 'circleSizeVal', 'px');
        _bindSlider('fontSize', 'fontSizeVal', 'px');
        _bindSlider('lineHeight', 'lineHeightVal', '');
        _bindSlider('formulaPadding', 'formulaPaddingVal', 'px');
        _bindSlider('padding', 'paddingVal', 'px');
        _bindSlider('borderWidth', 'borderWidthVal', 'px');

        // При смене диаметра — синхронизируем canvas редактора пути
        // (масштабируем уже нарисованные точки под новый размер).
        document.getElementById('circleSize').addEventListener('input', () => {
            const newSize = parseInt(document.getElementById('circleSize').value, 10);
            PathEditor.setCanvasSize(newSize);
        });

        // Кнопка «Сгенерировать»
        document.getElementById('generateBtn').addEventListener('click', generate);

        // Кнопка «Скачать все ZIP»
        document.getElementById('downloadAllZip').addEventListener('click', downloadAll);

        // Ctrl+Enter в textarea → генерация
        document.getElementById('textInput').addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                generate();
            }
        });
    }

    /**
     * Привязывает слайдер к его label.
     */
    function _bindSlider(sliderId, displayId, suffix) {
        const slider = document.getElementById(sliderId);
        const display = document.getElementById(displayId);
        slider.addEventListener('input', () => {
            display.textContent = slider.value + suffix;
        });
    }

    /**
     * Считывает текущие настройки из UI.
     */
    function _getSettings() {
        return {
            size: parseInt(document.getElementById('circleSize').value, 10),
            fontSize: parseInt(document.getElementById('fontSize').value, 10),
            lineHeight: parseFloat(document.getElementById('lineHeight').value),
            formulaPadding: parseInt(document.getElementById('formulaPadding').value, 10),
            padding: parseInt(document.getElementById('padding').value, 10),
            textColor: document.getElementById('textColor').value,
            bgColor: document.getElementById('bgColor').value,
            borderColor: document.getElementById('borderColor').value,
            borderWidth: parseInt(document.getElementById('borderWidth').value, 10),
            excludePath: _excludePath,
            excludeColor: document.getElementById('excludeColor').value
        };
    }

    /**
     * Коллбэк изменения пути из PathEditor.
     */
    function onPathChanged(pathData) {
        _excludePath = pathData;
        const input = document.getElementById('svgPathInput');
        if (pathData && input && document.activeElement !== input) {
            input.value = pathData;
        }
    }

    /**
     * Генерация скриншотов.
     */
    async function generate() {
        const text = document.getElementById('textInput').value;
        if (!text.trim()) {
            alert('Введите текст для генерации.');
            return;
        }

        if (typeof katex === 'undefined') {
            alert('KaTeX не загружен. Проверьте интернет-соединение и перезагрузите страницу.');
            return;
        }

        const settings = _getSettings();
        const btn = document.getElementById('generateBtn');
        btn.disabled = true;
        btn.textContent = '⏳ Генерация...';

        // Даём UI время обновиться
        await new Promise(r => setTimeout(r, 50));

        try {
            _canvases = await CircleRenderer.renderPages(text, settings);
            _renderPreview();
        } catch (err) {
            console.error('Ошибка генерации:', err);
            alert('Произошла ошибка. Подробности в консоли (F12).\n' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '▶ Сгенерировать';
        }
    }

    /**
     * Отображает сгенерированные canvas в предпросмотре.
     */
    function _renderPreview() {
        const preview = document.getElementById('preview');
        preview.innerHTML = '';

        if (_canvases.length === 0) {
            preview.innerHTML = `
                <div id="placeholder">
                    <p>Не удалось разместить текст. Попробуйте изменить настройки.</p>
                </div>`;
            document.getElementById('downloadAllZip').disabled = true;
            document.getElementById('pageCount').textContent = '';
            return;
        }

        // Счётчик
        const countEl = document.getElementById('pageCount');
        countEl.textContent = `${_canvases.length} ${_pluralize(_canvases.length, 'страница', 'страницы', 'страниц')}`;

        // Кнопка ZIP
        document.getElementById('downloadAllZip').disabled = false;

        // Карточки
        _canvases.forEach((canvas, i) => {
            const card = document.createElement('div');
            card.className = 'preview-card';

            const label = document.createElement('div');
            label.className = 'card-label';
            label.textContent = `Страница ${i + 1}`;
            card.appendChild(label);

            // Копия canvas для отображения
            const copy = document.createElement('canvas');
            copy.width = canvas.width;
            copy.height = canvas.height;
            copy.getContext('2d').drawImage(canvas, 0, 0);
            copy.style.maxWidth = '470px';
            copy.style.height = 'auto';
            card.appendChild(copy);

            const actions = document.createElement('div');
            actions.className = 'card-actions';

            const dlBtn = document.createElement('button');
            dlBtn.className = 'btn';
            dlBtn.textContent = '📥 Скачать PNG';
            dlBtn.addEventListener('click', () => {
                ExportManager.downloadPNG(canvas, `circle_${String(i + 1).padStart(3, '0')}.png`);
            });
            actions.appendChild(dlBtn);

            card.appendChild(actions);
            preview.appendChild(card);
        });
    }

    /**
     * Скачивает все как ZIP.
     */
    async function downloadAll() {
        if (_canvases.length === 0) return;
        try {
            await ExportManager.downloadAllZIP(_canvases, 'circles.zip');
        } catch (err) {
            console.error('Ошибка ZIP:', err);
            alert('Не удалось создать ZIP-архив.');
        }
    }

    function _pluralize(n, one, few, many) {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 19) return many;
        if (mod10 === 1) return one;
        if (mod10 >= 2 && mod10 <= 4) return few;
        return many;
    }

    document.addEventListener('DOMContentLoaded', init);

    return { generate };
})();
