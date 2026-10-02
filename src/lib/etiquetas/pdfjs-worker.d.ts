// O worker do pdf.js não traz declaração de tipos própria; é usado só para
// ser entregue ao pdf.js via globalThis.pdfjsWorker (ver recorte.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs'
