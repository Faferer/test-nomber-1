/**
 * textParser.js — Парсер текста + LaTeX → Canvas рендеринг.
 *
 * v5:
 *   - истинный baseline инлайн-формулы замеряется по эталонной букве "x":
 *     формулы больше не "плывут" относительно строки.
 *   - display-формулы центрируются по своему bounding box.
 *   - рисуются рамки/линии DOM-дерева (дробные черты, корни, черты
 *     над/под текстом) — дроби перестают быть "кривыми".
 *   - добавлены левая/правая границы и подчёркивания для полного
 *     отображения всех элементов KaTeX.
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
        // Создаём контейнер для измерения формулы
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: fixed;
            left: 0; top: 0;
            opacity: 0;
            pointer-events: none;
            z-index: -1;
            line-height: 1;
            font-size: ${texSize}px;
            white-space: nowrap;
            margin: 0;
            padding: 0;
            border: none;
        `;

        // Эталонный символ для определения baseline
        const ref = document.createElement('span');
        ref.textContent = 'x';
        ref.style.cssText = `
            font-family: Georgia, 'Times New Roman', serif;
            vertical-align: baseline;
            display: inline-block;
            margin: 0;
            padding: 0;
        `;

        // Контейнер формулы
        const mathContainer = document.createElement('span');
        mathContainer.style.cssText = `
            display: inline-block;
            vertical-align: baseline;
            line-height: 1;
            margin: 0;
            padding: 0;
        `;
        
        try {
            katex.render(latex, mathContainer, {
                displayMode: isDisplay,
                throwOnError: false,
                strict: false,
                trust: true
            });
        } catch (e) {
            mathContainer.textContent = latex;
        }

        wrapper.appendChild(ref);
        wrapper.appendChild(document.createTextNode(' '));
        wrapper.appendChild(mathContainer);
        document.body.appendChild(wrapper);

        const wrapRect = wrapper.getBoundingClientRect();
        const refRect = ref.getBoundingClientRect();
        const mathRect = mathContainer.getBoundingClientRect();

        let w = Math.ceil(mathRect.width);
        let h = Math.ceil(mathRect.height);

        if (w <= 0 || h <= 0) {
            document.body.removeChild(wrapper);
            return _fallback(latex, texSize, isDisplay);
        }

        // Добавляем запас со всех сторон для дробей и высоких элементов
        const padX = isDisplay ? 6 : 4;
        const padY = isDisplay ? 8 : 4;
        w += padX * 2;
        h += padY * 2;

        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = Math.max(1, w * scale);
        canvas.height = Math.max(1, h * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Рисуем формулу со смещением из-за padding
        const drawX = padX;
        const drawY = padY;
        _walkAndDraw(ctx, mathContainer, mathRect.left - drawX, mathRect.top - drawY, textColor);

        document.body.removeChild(wrapper);

        // Вычисляем baselineOffset точно
        // baselineRef - позиция базовой линии эталонного символа 'x'
        const baselineRef = refRect.bottom;
        // Позиция верха математического контейнера
        const mathTop = mathRect.top;
        // Смещение базовой линии от верха канваса
        let baselineOffset = baselineRef - mathTop + padY;

        // Ограничиваем baselineOffset разумными пределами
        baselineOffset = Math.max(padY + 2, Math.min(h - padY - 2, baselineOffset));

        canvas._drawW = w;
        canvas._drawH = h;

        return {
            type: isDisplay ? 'LATEX_DISPLAY' : 'LATEX_INLINE',
            content: latex,
            width: w,
            height: h,
            baselineOffset: Math.round(baselineOffset),
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
                const fs = style.fontSize || `${parentEl.style.fontSize || 16}px`;
                const ff = style.fontFamily || 'serif';
                const fw = style.fontWeight || 'normal';
                const color = _resolveColor(style.color, defaultColor);

                ctx.font = `${fw} ${fs} ${ff}`;
                ctx.fillStyle = color;
                ctx.textBaseline = 'alphabetic';
                ctx.letterSpacing = style.letterSpacing || 'normal';

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
        
        // Левая граница
        bw = parseFloat(style.borderLeftWidth) || 0;
        bc = _visibleColor(style.borderLeftColor, fallbackColor);
        if (bw > 0 && bc) {
            ctx.strokeStyle = bc;
            ctx.lineWidth = Math.max(0.5, bw);
            for (const r of rects) {
                ctx.beginPath();
                ctx.moveTo(r.left - pL + bw / 2, r.top - pT);
                ctx.lineTo(r.left - pL + bw / 2, r.bottom - pT);
                ctx.stroke();
            }
        }
        
        // Правая граница
        bw = parseFloat(style.borderRightWidth) || 0;
        bc = _visibleColor(style.borderRightColor, fallbackColor);
        if (bw > 0 && bc) {
            ctx.strokeStyle = bc;
            ctx.lineWidth = Math.max(0.5, bw);
            for (const r of rects) {
                ctx.beginPath();
                ctx.moveTo(r.right - pL - bw / 2, r.top - pT);
                ctx.lineTo(r.right - pL - bw / 2, r.bottom - pT);
                ctx.stroke();
            }
        }
        
        // Подчёркивания (text-decoration)
        const td = style.textDecoration;
        if (td && td !== 'none') {
            const tdc = _visibleColor(style.textDecorationColor, fallbackColor) || fallbackColor;
            const tds = style.textDecorationStyle || 'solid';
            const tdt = parseFloat(style.textDecorationThickness) || 1;
            
            ctx.strokeStyle = tdc;
            ctx.lineWidth = Math.max(0.5, tdt);
            if (tds === 'dashed') ctx.setLineDash([4, 3]);
            else if (tds === 'dotted') ctx.setLineDash([1, 2]);
            else ctx.setLineDash([]);
            
            for (const r of rects) {
                if (td.includes('underline')) {
                    ctx.beginPath();
                    ctx.moveTo(r.left - pL, r.bottom - pT - 2);
                    ctx.lineTo(r.right - pL, r.bottom - pT - 2);
                    ctx.stroke();
                }
                if (td.includes('overline')) {
                    ctx.beginPath();
                    ctx.moveTo(r.left - pL, r.top - pT + 2);
                    ctx.lineTo(r.right - pL, r.top - pT + 2);
                    ctx.stroke();
                }
            }
            ctx.setLineDash([]);
        }
        
        // Дробные черты и другие горизонтальные линии (border-top у внутренних элементов)
        // Проверяем все границы для каждого rect
        for (const r of rects) {
            // Горизонтальные линии внутри элемента (например, дробные черты)
            const children = el.querySelectorAll('*');
            for (const child of children) {
                const cstyle = window.getComputedStyle(child);
                const cRects = child.getClientRects();
                
                for (const cr of cRects) {
                    // Верхняя граница (дробная черта)
                    const topBw = parseFloat(cstyle.borderTopWidth) || 0;
                    const topBc = _visibleColor(cstyle.borderTopColor, fallbackColor);
                    if (topBw > 0 && topBc) {
                        ctx.strokeStyle = topBc;
                        ctx.lineWidth = Math.max(0.5, topBw);
                        ctx.beginPath();
                        ctx.moveTo(cr.left - pL, cr.top - pT + topBw / 2);
                        ctx.lineTo(cr.right - pL, cr.top - pT + topBw / 2);
                        ctx.stroke();
                    }
                    
                    // Нижняя граница
                    const botBw = parseFloat(cstyle.borderBottomWidth) || 0;
                    const botBc = _visibleColor(cstyle.borderBottomColor, fallbackColor);
                    if (botBw > 0 && botBc) {
                        ctx.strokeStyle = botBc;
                        ctx.lineWidth = Math.max(0.5, botBw);
                        ctx.beginPath();
                        ctx.moveTo(cr.left - pL, cr.bottom - pT - botBw / 2);
                        ctx.lineTo(cr.right - pL, cr.bottom - pT - botBw / 2);
                        ctx.stroke();
                    }
                    
                    // Левая граница
                    const leftBw = parseFloat(cstyle.borderLeftWidth) || 0;
                    const leftBc = _visibleColor(cstyle.borderLeftColor, fallbackColor);
                    if (leftBw > 0 && leftBc) {
                        ctx.strokeStyle = leftBc;
                        ctx.lineWidth = Math.max(0.5, leftBw);
                        ctx.beginPath();
                        ctx.moveTo(cr.left - pL + leftBw / 2, cr.top - pT);
                        ctx.lineTo(cr.left - pL + leftBw / 2, cr.bottom - pT);
                        ctx.stroke();
                    }
                    
                    // Правая граница
                    const rightBw = parseFloat(cstyle.borderRightWidth) || 0;
                    const rightBc = _visibleColor(cstyle.borderRightColor, fallbackColor);
                    if (rightBw > 0 && rightBc) {
                        ctx.strokeStyle = rightBc;
                        ctx.lineWidth = Math.max(0.5, rightBw);
                        ctx.beginPath();
                        ctx.moveTo(cr.right - pL - rightBw / 2, cr.top - pT);
                        ctx.lineTo(cr.right - pL - rightBw / 2, cr.bottom - pT);
                        ctx.stroke();
                    }
                }
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

        const baselineOffset = isDisplay
            ? Math.round(h * 0.6)
            : Math.round(h * 0.72);

        return {
            type: isDisplay ? 'LATEX_DISPLAY' : 'LATEX_INLINE',
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