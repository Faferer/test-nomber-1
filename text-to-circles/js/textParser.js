/**
 * textParser.js — Парсер текста + LaTeX → Canvas рендеринг.
 *
 * v4:
 *   - истинный baseline инлайн-формулы замеряется по эталонной букве "x":
 *     формулы больше не "плывут" относительно строки.
 *   - display-формулы центрируются по своему bounding box.
 *   - рисуются рамки/линии DOM-дерева (дробные черты, корни, черты *     над/под текстом) — дроби перестают быть "кривыми".
 */

const TextParser = (() => {

    function tokenize(text) {
        const tokens = [];
        const regex = /\$\$([\s\S]+?)\$\$|\$([^\$\n]+?)\$|([^$]+)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match[1] !== undefined) {
                tokens.push({ type: 'LATEX_DISPLAY', content: match[1].trim() });
            } else if (match[2] !== undefined) {
                tokens.push({ type: 'LATEX_INLINE', content: match[2].trim() });
            } else if (match[3] !== undefined) {
                const parts = match[3].split(/(\s+)/);
                for (const p of parts) {
                    if (p.length > 0) {
                        tokens.push({ type: 'PLAIN_TEXT', content: p });
                    }
                }
            }
        }
        return tokens;
    }

    async function measure(tokens, opts) {
        const { fontSize, fontFamily, fontWeight, textColor } = opts;
        const fontStr = `${fontWeight || 'normal'} ${fontSize}px ${fontFamily || 'serif'}`;

        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = fontStr;

        const measured = [];

        for (const token of tokens) {
            if (token.type === 'PLAIN_TEXT') {
                const m = ctx.measureText(token.content);
                measured.push({
                    ...token,
                    width: m.width,
                    height: fontSize,
                    baselineOffset: m.actualBoundingBoxAscent || Math.round(fontSize * 0.78),
                    canvas: null
                });
            } else {
                const isDisplay = token.type === 'LATEX_DISPLAY';
                const texSize = isDisplay ? Math.round(fontSize * 1.15) : fontSize;

                const result = await _renderFormula(token.content, texSize, isDisplay, textColor);
                measured.push(result);
            }
        }

        return measured;
    }

    async function _renderFormula(latex, texSize, isDisplay, textColor) {
        // Контейнер: эталонный текст + формула в одной строке, чтобы
 // получить общий baseline.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: fixed;
            left: 0; top: 0;
            opacity: 0;
            pointer-events: none;
            z-index: -1;
            line-height: 1.2;
            font-size: ${texSize}px;
        `;

        const ref = document.createElement('span');
        ref.textContent = 'x';
        ref.style.cssText = `
            font-family: Georgia, 'Times New Roman', serif;
            vertical-align: baseline;
        `;

        const math = document.createElement('span');
        try {
            katex.render(latex, math, {
                displayMode: isDisplay,
                throwOnError: false,
                strict: false
            });
        } catch (e) {
            math.textContent = latex;
        }

        wrapper.appendChild(ref);
        wrapper.appendChild(math);
        document.body.appendChild(wrapper);

        const wrapRect = wrapper.getBoundingClientRect();
        const refRect = ref.getBoundingClientRect();
        const mathRect = math.getBoundingClientRect();

        const w = Math.ceil(mathRect.width);
        const h = Math.ceil(mathRect.height);

        if (w <= 0 || h <= 0) {
            document.body.removeChild(wrapper);
            return _fallback(latex, texSize, isDisplay);
        }

        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        _walkAndDraw(ctx, math, mathRect.left, mathRect.top, textColor);

        document.body.removeChild(wrapper);

        const baselineOffset = isDisplay
            ? Math.round(h * 0.5)
            : Math.max(1, Math.round(refRect.bottom - mathRect.top));

        canvas._drawW = w;
        canvas._drawH = h;

        return {
            type: isDisplay ? 'LATEX_DISPLAY' : 'LATEX_INLINE',
            content: latex,
            width: w,
            height: h,
            baselineOffset,
            canvas: canvas
        };
    }

    function _walkAndDraw(ctx, parent, parentLeft, parentTop, defaultColor) {
        for (const child of parent.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (_isMathmlCopy(child)) continue;

                _drawElementDecorations(ctx, child, parentLeft, parentTop, defaultColor);
                _walkAndDraw(ctx, child, parentLeft, parentTop, defaultColor);
            } else if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (!text.trim()) continue;

                const parentEl = child.parentElement;
                if (!parentEl) continue;

                const style = window.getComputedStyle(parentEl);
                const fs = style.fontSize || `${parentEl.style.fontSize ||16}px`;
                const ff = style.fontFamily || 'serif';
                const fw = style.fontWeight || 'normal';
                const color = _resolveColor(style.color, defaultColor);

                ctx.font = `${fw} ${fs} ${ff}`;
                ctx.fillStyle = color;
                ctx.textBaseline = 'alphabetic';

                const range = document.createRange();
                range.selectNodeContents(child);
                const rects = range.getClientRects();

                for (const r of rects) {
                    const x = r.left - parentLeft;
                    const y = r.bottom - parentTop;
                    ctx.fillText(text, x, y);
                }
            }
        }
    }

    function _drawElementDecorations(ctx, el, parentLeft, parentTop, fallbackColor) {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'svg' || tag === 'math') return;

        const style = window.getComputedStyle(el);
        const rects = el.getClientRects();
        if (!rects.length) return;

        const pL = parentLeft;
        const pT = parentTop;

        // Фон
        const bg = _visibleColor(style.backgroundColor, fallbackColor);
        if (bg) {
            ctx.fillStyle = bg;
            for (const r of rects) {
                ctx.fillRect(r.left - pL, r.top - pT, r.width, r.height);
            }
        }

        // Верхняя граница
        let bw = parseFloat(style.borderTopWidth) || 0;
        let bc = _visibleColor(style.borderTopColor, fallbackColor);
        if (bw > 0 && bc) {
            ctx.strokeStyle = bc;
            ctx.lineWidth = Math.max(0.5, bw);
            for (const r of rects) {
                ctx.beginPath();
                ctx.moveTo(r.left - pL, r.top - pT + bw / 2);
                ctx.lineTo(r.right - pL, r.top - pT + bw / 2);
                ctx.stroke();
            }
        }

        // Нижняя граница
        bw = parseFloat(style.borderBottomWidth) || 0;
        bc = _visibleColor(style.borderBottomColor, fallbackColor);
        if (bw > 0 && bc) {
            ctx.strokeStyle = bc;
            ctx.lineWidth = Math.max(0.5, bw);
            for (const r of rects) {
                ctx.beginPath();
                ctx.moveTo(r.left - pL, r.bottom - pT - bw / 2);
                ctx.lineTo(r.right - pL, r.bottom - pT - bw / 2);
                ctx.stroke();
            }
        }
    }

    function _visibleColor(cssColor, fallback) {
        if (!cssColor) return null;
        const trans = ['rgba(0, 0, 0, 0)', 'transparent'];
        if (trans.includes(cssColor)) return null;
        return _resolveColor(cssColor, fallback);
    }

    function _isMathmlCopy(el) {
        const cls = _elementClass(el);
        if (/\bkatex-mathml\b/.test(cls)) return true;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'annotation') return true;
        return false;
    }

    function _elementClass(el) {
        if (typeof el.className === 'string') return el.className;
        if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
        return (el.getAttribute && el.getAttribute('class')) || '';
    }

    function _resolveColor(cssColor, defaultColor) {
        const blackish = ['#000000', '#000', 'rgb(0, 0, 0)', 'black', 'rgba(0,0,0,1)'];
        if (cssColor && !blackish.includes(cssColor.toLowerCase().trim())) {
            return cssColor;
        }
        return defaultColor || '#ffffff';
    }

    function _fallback(latex, texSize, isDisplay) {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${texSize}px serif`;
        const m = ctx.measureText(latex);
        const w = Math.ceil(m.width) + 4;
        const h = Math.ceil(texSize * 1.4);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d');
        c.font = `${texSize}px serif`;
        c.fillStyle = '#ffffff';
        c.textBaseline = 'alphabetic';
        c.fillText(latex, 2, h * 0.85);

        canvas._drawW = w;
        canvas._drawH = h;

        const baselineOffset = isDisplay            ? Math.round(h * 0.5)
            : Math.round(h * 0.72);

        return {
            type: 'LATEX_INLINE',
            content: latex,
            width: w,
            height: h,
            baselineOffset,
            canvas: canvas
        };
    }

    function prepareForLayout(tokens) {
        const result = [];
        for (const token of tokens) {
            if (token.type === 'PLAIN_TEXT') {
                if (/^\s+$/.test(token.content)) {
                    if (result.length > 0) result[result.length - 1]._spaceAfter = true;
                } else if (/\n/.test(token.content)) {
                    if (result.length > 0) result[result.length - 1]._forceBreak = true;
                } else {
                    result.push({ ...token, _spaceAfter: false, _forceBreak: false });
                }
            } else {
                result.push({ ...token, _spaceAfter: false, _forceBreak: false });
            }
        }
        return result;
    }

    return { tokenize, measure, prepareForLayout };
})();