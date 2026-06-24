/**
 * pathEditor.js — Интерактивный редактор SVG-пути для области вырезания.
 *
 * Два режима:
 *   1. Текстовый — ввод SVG path data вручную
 *   2. Визуальный — рисование полигона кликами на canvas
 *
 * Коллбэки:
 *   onPathChange(pathData) — вызывается при каждом изменении пути
 */

const PathEditor = (() => {

    let _points = [];          // Точки полигона [{x, y}, ...]
    let _isClosed = false;     // Замкнут ли полигон
    let _onPathChange = null;  // Коллбэк
    let _canvas = null;
    let _ctx = null;

    /**
     * Инициализация.
     * @param {Function} onPathChange — коллбэк при изменении пути
     */
    function init(onPathChange) {
        _onPathChange = onPathChange;
        _canvas = document.getElementById('pathDrawCanvas');
        _ctx = _canvas.getContext('2d');

        // Рисуем начальное состояние (круг-подсказка)
        _drawBackground();

        // События
        _canvas.addEventListener('click', _onCanvasClick);
        _canvas.addEventListener('contextmenu', _onCanvasRightClick);
        document.addEventListener('keydown', _onKeyDown);

        // Кнопка «Применить» для текстового ввода
        document.getElementById('applyPathBtn').addEventListener('click', _applyTextPath);

        // Табы
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tabId = btn.dataset.tab;
                const content = document.getElementById(tabId);
                if (content) content.classList.add('active');
            });
        });
    }

    /**
     * Обрабатывает клик ЛКМ на canvas — добавляет точку.
     */
    function _onCanvasClick(e) {
        e.preventDefault();
        if (_isClosed) return;

        const rect = _canvas.getBoundingClientRect();
        const scaleX = _canvas.width / rect.width;
        const scaleY = _canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        _points.push({ x, y });
        _redraw();
        _notifyChange();
    }

    /**
     * Обрабатывает клик ПКМ — замыкает фигуру.
     */
    function _onCanvasRightClick(e) {
        e.preventDefault();
        if (_points.length < 3) return;
        _isClosed = true;
        _redraw();
        _notifyChange();
    }

    /**
     * Ctrl+Z — отменяет последнюю точку.
     */
    function _onKeyDown(e) {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            if (_isClosed) {
                _isClosed = false;
            } else if (_points.length > 0) {
                _points.pop();
            }
            _redraw();
            _notifyChange();
        }
    }

    /**
     * Применяет SVG-путь из текстового поля.
     */
    function _applyTextPath() {
        const input = document.getElementById('svgPathInput');
        const pathData = input.value.trim();
        if (pathData) {
            _onPathChange(pathData);
        }
    }

    /**
     * Перерисовывает canvas с текущим состоянием полигона.
     */
    function _redraw() {
        _drawBackground();

        if (_points.length === 0) return;

        _ctx.strokeStyle = '#e94560';
        _ctx.lineWidth = 2;
        _ctx.setLineDash([6, 4]);
        _ctx.beginPath();

        _ctx.moveTo(_points[0].x, _points[0].y);
        for (let i = 1; i < _points.length; i++) {
            _ctx.lineTo(_points[i].x, _points[i].y);
        }

        if (_isClosed) {
            _ctx.closePath();
            _ctx.fillStyle = 'rgba(22, 33, 62, 0.7)';
            _ctx.fill();
        }

        _ctx.stroke();
        _ctx.setLineDash([]);

        // Точки
        for (const p of _points) {
            _ctx.fillStyle = '#e94560';
            _ctx.beginPath();
            _ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            _ctx.fill();

            _ctx.strokeStyle = '#fff';
            _ctx.lineWidth = 1;
            _ctx.stroke();
        }
    }

    /**
     * Рисует фон canvas: серый фон + круг-подсказка.
     */
    function _drawBackground() {
        const ctx = _ctx;
        const size = _canvas.width;
        const center = size / 2;

        ctx.clearRect(0, 0, size, size);

        // Фон
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, size, size);

        // Сетка (каждые 50px)
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= size; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, size);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(size, i);
            ctx.stroke();
        }

        // Круг-подсказка
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(center, center, center - 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Центр
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(center, center, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Преобразует текущие точки в SVG path data.
     */
    function _pointsToPath() {
        if (_points.length === 0) return null;

        let d = `M ${Math.round(_points[0].x)} ${Math.round(_points[0].y)}`;
        for (let i = 1; i < _points.length; i++) {
            d += ` L ${Math.round(_points[i].x)} ${Math.round(_points[i].y)}`;
        }
        if (_isClosed) {
            d += ' Z';
        }
        return d;
    }

    /**
     * Уведомляет о change.
     */
    function _notifyChange() {
        if (_onPathChange) {
            _onPathChange(_pointsToPath());
        }
    }

    /**
     * Очищает текущий путь.
     */
    function clear() {
        _points = [];
        _isClosed = false;
        _redraw();
        if (_onPathChange) _onPathChange(null);
    }

    /**
     * Устанавливает путь из строки (из текстового поля).
     */
    function setPath(pathData) {
        if (!pathData) {
            clear();
            return;
        }
        // Обновляем текстовое поле
        const input = document.getElementById('svgPathInput');
        if (input) input.value = pathData;
        if (_onPathChange) _onPathChange(pathData);
    }

    /**
     * Меняет размер canvas-редактора, пропорционально перенося
     * уже нарисованные точки полигона. После этого уведомляет
     * коллбэк новым SVG-путем (в координатах нового размера).
     */
    function setCanvasSize(newSize) {
        const oldSize = _canvas.width;
        newSize = Math.max(64, Math.round(newSize));
        if (newSize === oldSize) return;

        const scale = newSize / oldSize;
        for (const p of _points) {
            p.x = Math.round(p.x * scale);
            p.y = Math.round(p.y * scale);
        }

        _canvas.width = newSize;
        _canvas.height = newSize;
        _ctx = _canvas.getContext('2d');

        _redraw();
        _notifyChange();
    }

    return {
        init,
        clear,
        setPath,
        setCanvasSize
    };
})();
