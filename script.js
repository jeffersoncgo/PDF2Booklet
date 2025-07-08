const A4 = { height: 595.28, width: 841.89 };
let generatedPdfURL = null;

const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
fileInput.addEventListener('change', () => {
  fileNameDisplay.textContent = fileInput.files[0]?.name || '';
  document.getElementById('viewBtn').style.display = 'none';
  document.getElementById('printInstructions').style.display = 'none';
});

function updateProgress(percent, text) {
  const bar = document.getElementById('progressBar');
  document.getElementById('progressContainer').style.display = 'block';
  bar.style.width = percent + '%';
  bar.setAttribute('aria-valuenow', percent);
  document.getElementById('progressText').textContent = text;
}

function resetProgress() {
  document.getElementById('progressContainer').style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressText').textContent = '';
}

async function drawTwoPages(imposedPdf, srcPdf, indexA, indexB) {
  const page = imposedPdf.addPage([A4.height * 2, A4.width]);
  if (indexA !== null) {
    const [p] = await srcPdf.copyPages(srcPdf, [indexA]);
    const emb = await imposedPdf.embedPage(p);
    page.drawPage(emb, { x: 0, y: 0, width: A4.height, height: A4.width });
  }
  if (indexB !== null) {
    const [p] = await srcPdf.copyPages(srcPdf, [indexB]);
    const emb = await imposedPdf.embedPage(p);
    page.drawPage(emb, { x: A4.height, y: 0, width: A4.height, height: A4.width });
  }
}

async function generateBooklet(inputBytes, password) {
  updateProgress(5, '🔐 Loading PDF...');
  const srcPdf = await PDFLib.PDFDocument.load(inputBytes, {
    ignoreEncryption: false,
    password: password
  });

  const original = srcPdf.getPageCount();
  const toAdd = (4 - (original % 4)) % 4;
  const total = original + toAdd;
  const imposedPdf = await PDFLib.PDFDocument.create();

  for (let i = 0; i < total / 4; i++) {
    const safe = idx => idx >= original ? null : idx;
    updateProgress(10 + Math.floor((i / (total / 4)) * 80), `🗂️ Processing sheet ${i + 1} of ${total / 4}...`);
    const l1 = total - 1 - 2 * i,
      r1 = 2 * i,
      l2 = 2 * i + 1,
      r2 = total - 2 - 2 * i;
    await drawTwoPages(imposedPdf, srcPdf, safe(l1), safe(r1));
    await drawTwoPages(imposedPdf, srcPdf, safe(l2), safe(r2));
    await new Promise(r => setTimeout(r, 50));
  }

  updateProgress(95, '💾 Finalizing PDF...');
  const pdfBytes = await imposedPdf.save();
  updateProgress(100, '✅ Booklet Ready!');

  return new Blob([pdfBytes], { type: 'application/pdf' });
}

async function generateBookletWithFallback(inputBytes, password, allowFlatten) {
  try {
    return await generateBooklet(inputBytes, password);
  } catch (err) {
    const msg = err?.message || "";
    const isEncryptedError =
      msg.includes("encrypted") ||
      msg.includes("Password") ||
      msg.includes("Failed to decrypt") ||
      msg.includes("Unknown compression");

    if (isEncryptedError) {
      updateProgress(5, "🔒 Encrypted. Checking flattening option...");
      if (allowFlatten) {
        document.getElementById('errorMsg').textContent = '⚠️ PDF is encrypted, flattening enabled...';
        const flatBytes = await flattenPDF(inputBytes);
        updateProgress(85, "📖 Regenerating from flattened PDF...");
        return await generateBooklet(flatBytes);
      } else {
        document.getElementById('decryptHelp').style.display = 'block';
        throw new Error("Encrypted PDF – try enabling 'Flatten PDF' or follow decryption tips below.");
      }
    } else {
      throw err;
    }
  }
}

async function flattenPDF(inputBytes) {
  const loadingTask = pdfjsLib.getDocument({ data: inputBytes });
  const pdf = await loadingTask.promise;
  const flattenedPdf = await PDFLib.PDFDocument.create();

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 2 }); // high-res
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;

    const pngDataUrl = canvas.toDataURL("image/png");
    const pngBytes = await fetch(pngDataUrl).then(res => res.arrayBuffer());
    const image = await flattenedPdf.embedPng(pngBytes);

    const pdfPage = flattenedPdf.addPage([image.width, image.height]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    });

    updateProgress(Math.floor((i / pdf.numPages) * 80), `🖼️ Flattening page ${i + 1}...`);
  }

  return await flattenedPdf.save();
}

document.getElementById("generateBtn").addEventListener("click", async () => {
  resetProgress();
  document.getElementById("errorMsg").textContent = '';
  document.getElementById("viewBtn").style.display = 'none';
  document.getElementById("printInstructions").style.display = 'none';
  document.getElementById("decryptHelp").style.display = 'none';

  if (!fileInput.files.length) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const bytes = new Uint8Array(reader.result);
      const pw = document.getElementById("passwordInput").value.trim();
      const allowFlatten = document.getElementById("flattenCheckbox").checked;
      const blob = await generateBookletWithFallback(bytes, pw, allowFlatten);

      if (generatedPdfURL) URL.revokeObjectURL(generatedPdfURL);
      generatedPdfURL = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));

      const downloadLink = document.createElement("a");
      downloadLink.href = generatedPdfURL;
      downloadLink.download = fileInput.files[0].name.replace(/\.pdf$/i, '') + "-booklet.pdf";
      downloadLink.click();

      document.getElementById("viewBtn").style.display = "block";
      document.getElementById("printInstructions").style.display = "block";
      resetProgress();
    } catch (err) {
      console.error(err);
      document.getElementById("errorMsg").textContent = "❌ " + err.message;
      resetProgress();
    }
  };
  reader.readAsArrayBuffer(fileInput.files[0]);
});

document.getElementById('viewBtn').addEventListener('click', () => {
  if (generatedPdfURL) {
    window.open(generatedPdfURL, '_blank');
  }
});