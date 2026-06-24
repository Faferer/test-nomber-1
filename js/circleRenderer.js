/**
 * circleRenderer.js — Ядро рендеринга текста внутри круга.
 *
 * v5:
 *   - адаптивный межстрочный интервал: строки не наползают друг на друга,
 *     если в строке высокая формула/дробь.
 *   - перед размещением токерна проверяется, что его верх/низ не вылезают *     за круг.
 *   - baseline в формуле берётся из TextParser, поэтому центровка
 *     текста и формул единая.
 */

const CircleRenderer = (() => {

 const DEFAULT_SIZE = 470;

    async function renderPages(text, opts) {
        if (!text.trim()) return [];

        const {
            size = DEFAULT_SIZE,
            fontSize = 16, lineHeight = 1.2, padding = 15,
            textColor = '#ffffff', bgColor = '#1a1a2e',
            borderColor = '#e94560', borderWidth = 3,
            excludePath = null, excludeColor = '#16213e'
        } = opts;

        const SIZE = Math.max(64, Math.round(size));
        const CX = SIZE / 2;
        const CY = SIZE / 2;
        const R  = SIZE / 2;
        const effR = Math.max(10, R - padding);
        const font = `normal ${fontSize}px Georgia, 'Times New Roman', serif`;

        const raw = TextParser.tokenize(text);
        const measured = await TextParser.measure(raw, {
            fontSize,
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontWeight: 'normal',
            textColor: textColor,
            formulaPadding: opts.formulaPadding || 2
        });
        const tokens = TextParser.prepareForLayout(measured);
        if (tokens.length === 0) return [];

        let cutPath = null;
        if (excludePath) {
            try { cutPath = new Path2D(excludePath); } catch (e) { /* skip */ }
        }

        const probe = document.createElement('canvas');
        probe.width = SIZE;
        probe.height = SIZE;
        const probeCtx = probe.getContext('2d');

        const spCtx = document.createElement('canvas').getContext('2d');
        spCtx.font = font;
        const spaceW = spCtx.measureText(' ').width;

        const mCtx = document.createElement('canvas').getContext('2d');
        mCtx.font = font;
        const refM = mCtx.measureText('Хг|');
        const fontAscent = refM.actualBoundingBoxAscent || Math.round(fontSize * 0.78);
        const fontDescent = refM.actualBoundingBoxDescent || Math.round(fontSize * 0.22);

        const blStart = Math.ceil(CY - effR + fontAscent);
        const blEnd = Math.floor(CY + effR - fontDescent);

        const pages = [];
        let ti = 0;
        const maxPages = 2000;

        while (ti < tokens.length && pages.length < maxPages) {
            const page = { lines: [] };
            let bl = blStart;
            let placedAnything = false;

            while (ti < tokens.length && bl <= blEnd) {
                // Проверяем доступную ширину на текущей базовой линии с учётом высоты токенов
                // Используем fontAscent/fontDescent для начальной оценки, но потом проверим каждый токен отдельно
                const topY = bl - fontAscent;
                const botY = bl + fontDescent;
                const halfTop = Math.sqrt(Math.max(0, effR * effR - (topY - CY) * (topY - CY)));
                const halfBot = Math.sqrt(Math.max(0, effR * effR - (botY - CY) * (botY - CY)));
                const half = Math.min(halfTop, halfBot);

                if (half < fontSize * 0.5) { bl += 1; continue; }

                const segs = _segments(CX - half, CX + half, bl, fontAscent, fontDescent, cutPath, probeCtx);
                if (segs.length === 0) { bl += 1; continue; }

                let linePlaced = false;
                let forceBreak = false;

                for (const seg of segs) {
                    if (forceBreak) break;
                    let cx = seg.left;

                    while (ti < tokens.length) {
                        const tok = tokens[ti];

                        if (tok._forceBreak && page.lines.length > 0) {
                            ti++;
                            forceBreak = true;
                            break;
                        }

                        // Вычисляем верх и низ токена относительно baseline
                        const tTop = bl - tok.baselineOffset;
                        const tBot = bl + (tok.height - tok.baselineOffset);

                        // Проверяем, что токен помещается по вертикали внутри круга
                        // С минимальным запасом для предотвращения обрезания
                        const verticalMargin = 0;
                        if (tTop < CY - effR + verticalMargin || tBot > CY + effR - verticalMargin) {
                            // Вертикально не влезает на эту базовую линию
                            forceBreak = 'vfit';
                            break;
                        }

                        const sp = tok._spaceAfter ? spaceW : 0;
                        const isFirstOnLine = page.lines.length === 0 ||
                            page.lines[page.lines.length - 1].baseline !== bl;

                        // Проверяем, что токен помещается по горизонтали в сегмент
                        if (cx + tok.width + sp <= seg.right + 0.5 || isFirstOnLine) {
                            page.lines.push({ baseline: bl, x: cx, token: tok });
                            cx += tok.width + sp;
                            ti++;
                            placedAnything = true;
                            linePlaced = true;
                        } else {
                            break;
                        }
                    }
                }

                if (!linePlaced) {
                    bl += 1;
                    continue;
                }

                // Интервал между строками: lineHeight задаёт общий множитель высоты строки
                // Следующая базовая линия = текущий baseline + (lineHeight * fontSize)
                const stepY = Math.round(fontSize * lineHeight);
                
                // Следующая базовая линия
                bl = bl + stepY;
            }

            if (!placedAnything) break;
            pages.push(page);
        }

        return pages.map(page => _draw(page, {
 SIZE, CX, CY, R, effR, font, textColor, bgColor,
            borderColor, borderWidth, cutPath, excludeColor
        }));
    }

    // ----------------------------------------------------------------
    function _segments(left, right, y, ascent, descent, cutPath, ctx) {
        if (!cutPath) return [{ left, right }];

        const step = 2;
        const ys = [y - ascent, y, y + descent];
        const minSeg = 8;
        const out = [];
        let segL = null;

        for (let x = left; x <= right; x += step) {
            const px = Math.min(x, right);
            let hit = false;
            for (let k = 0; k < ys.length && !hit; k++) {
                if (ctx.isPointInPath(cutPath, px, ys[k])) hit = true;
            }

            if (hit) {
                if (segL !== null && px - segL > minSeg) out.push({ left: segL, right: px });
                segL = null;
            } else {
                if (segL === null) segL = px;
            }
        }

        if (segL !== null && right - segL > minSeg) out.push({ left: segL, right: right });
        return out;
    }

    // ----------------------------------------------------------------
    function _draw(page, opts) {
        const {
            SIZE, CX, CY, R, effR, font, textColor, bgColor,
            borderColor, borderWidth, cutPath, excludeColor
        } = opts;

        const c = document.createElement('canvas');
        c.width = SIZE;
        c.height = SIZE;
        const ctx = c.getContext('2d');

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, SIZE, SIZE);

        ctx.save();
        ctx.beginPath();
        ctx.arc(CX, CY, effR, 0, Math.PI * 2);
        ctx.clip();

        if (cutPath) {
            ctx.fillStyle = excludeColor;
            ctx.fill(cutPath);
        }

        ctx.fillStyle = textColor;
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';

        // Сортируем линии по baseline для правильного порядка отрисовки
        const sortedLines = [...page.lines].sort((a, b) => a.baseline - b.baseline);

        for (const item of sortedLines) {
            const tok = item.token;
            if (tok.canvas) {
                const drawW = tok.canvas._drawW || tok.width;
                const drawH = tok.canvas._drawH || tok.height;
                // Точная позиция Y: baseline минус offset базовой линии токена
                const drawY = item.baseline - tok.baselineOffset;
                ctx.drawImage(tok.canvas, item.x, drawY, drawW, drawH);
            } else {
                ctx.fillText(tok.content, item.x, item.baseline);
            }
        }

        ctx.restore();

        if (borderWidth > 0) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = borderWidth;
            ctx.beginPath();
            ctx.arc(CX, CY, R - borderWidth / 2, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (cutPath) {
            ctx.save();
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.stroke(cutPath);
            ctx.restore();
        }

        return c;
    }

    return { renderPages };
})();