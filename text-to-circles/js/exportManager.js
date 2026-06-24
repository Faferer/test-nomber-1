/**
 * exportManager.js — Экспорт сгенерированных скриншотов.
 */

const ExportManager = (() => {

    function downloadPNG(canvas, filename) {
        canvas.toBlob(blob => {
            if (blob) {
                saveAs(blob, filename);
            }
        }, 'image/png');
    }

    async function downloadAllZIP(canvases, zipName = 'circles.zip') {
        const zip = new JSZip();
        const folder = zip.folder('circles');

        for (let i = 0; i < canvases.length; i++) {
            const filename = `circle_${String(i + 1).padStart(3, '0')}.png`;
            const blob = await canvasToBlob(canvases[i]);
            if (blob) {
                folder.file(filename, blob);
            }
        }

        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, zipName);
    }

    function canvasToBlob(canvas) {
        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        });
    }

    return { downloadPNG, downloadAllZIP };
})();
