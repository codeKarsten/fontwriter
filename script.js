document.addEventListener('DOMContentLoaded', function () {
	const STORAGE_KEY = 'fontwriter-settings-v1';

	const BUILTIN_LETTERS = Array.from({ length: 224 }, function (_, index) {
		return String.fromCharCode(index + 32);
	}).join('');

	const textInput = document.getElementById('textInput');
	const radioDefault = document.getElementById('radioDefault');
	const radioCustom = document.getElementById('radioCustom');
	const customImage = document.getElementById('customImage');
	const imageInput = document.getElementById('imageInput');
	const inputImage = document.getElementById('inputImage');
	const letterInput = document.getElementById('letterInput');
	const customBackgroundToggle = document.getElementById('customBackgroundToggle');
	const customBackground = document.getElementById('customBackground');
	const fontSize = document.getElementById('fontSize');
	const lineSpacing = document.getElementById('lineSpacing');
	const characterSpacing = document.getElementById('characterSpacing');
	const maxWidth = document.getElementById('maxWidth');
	const fontSizeValue = document.getElementById('fontSizeValue');
	const lineSpacingValue = document.getElementById('lineSpacingValue');
	const characterSpacingValue = document.getElementById('characterSpacingValue');
	const maxWidthValue = document.getElementById('maxWidthValue');
	const generateButton = document.getElementById('generateButton');
	const exportPngButton = document.getElementById('exportPngButton');
	const exportWebpButton = document.getElementById('exportWebpButton');

	const statusMessage = document.getElementById('statusMessage');
	const canvas = document.getElementById('outputCanvas');
	const context = canvas.getContext('2d', { willReadFrequently: true });
	const CUSTOM_DEFAULT_LETTERS = letterInput.value;
	const crcTable = createCrcTable();
	const textEncoder = new TextEncoder();

	let renderQueued = false;
	let currentImageDataUrl = inputImage.currentSrc || inputImage.src;
	let lastCustomLetters = CUSTOM_DEFAULT_LETTERS;

	if (!letterInput.value) {
		letterInput.value = CUSTOM_DEFAULT_LETTERS;
	}

	loadSettings();
	updateSourceMode();
	updateSettingLabels();

	radioDefault.addEventListener('change', function () {
		if (radioDefault.checked) {
			updateSourceMode();
			saveSettings();
			scheduleRender();
		}
	});

	radioCustom.addEventListener('change', function () {
		if (radioCustom.checked) {
			updateSourceMode();
			saveSettings();
			scheduleRender();
		}
	});

	imageInput.addEventListener('change', function (event) {
		const file = event.target.files[0];
		if (!file) {
			return;
		}

		const reader = new FileReader();
		reader.onload = function (loadEvent) {
			currentImageDataUrl = loadEvent.target.result;
			inputImage.src = currentImageDataUrl;
			inputImage.style.display = 'block';
			radioCustom.checked = true;
			radioDefault.checked = false;
			updateSourceMode();
			saveSettings();
		};
		reader.readAsDataURL(file);
	});

	inputImage.addEventListener('load', function () {
		if (!currentImageDataUrl) {
			currentImageDataUrl = inputImage.currentSrc || inputImage.src;
		}
		scheduleRender();
	});

	[
		textInput,
		letterInput,
		customBackgroundToggle,
		customBackground,
		fontSize,
		lineSpacing,
		characterSpacing,
		maxWidth
	].forEach(function (element) {
		const eventName = element.tagName === 'TEXTAREA' || element.type === 'text' ? 'input' : 'change';
		const secondaryEvent = eventName === 'input' ? 'change' : 'input';
		element.addEventListener(eventName, handleLiveUpdate);
		element.addEventListener(secondaryEvent, handleLiveUpdate);
	});

	generateButton.addEventListener('click', function () {
		renderCanvas();
		setStatus('Preview updated.');
	});

	exportPngButton.addEventListener('click', function () {
		renderCanvas();
		downloadCanvas('image/png', 'fontwriter-export.png');
	});

	exportWebpButton.addEventListener('click', function () {
		renderCanvas();
		downloadCanvas('image/webp', 'fontwriter-export.webp');
	});

	configureContext(context);

	if (inputImage.complete && inputImage.naturalWidth > 0) {
		scheduleRender();
	}

	function handleLiveUpdate() {
		updateSettingLabels();
		saveSettings();
		scheduleRender();
	}

	function scheduleRender() {
		if (renderQueued) {
			return;
		}

		renderQueued = true;
		window.requestAnimationFrame(function () {
			renderQueued = false;
			renderCanvas();
		});
	}

	function renderCanvas(limitCharacters) {
		const layout = buildLayout(limitCharacters);
		canvas.width = layout.canvasWidth;
		canvas.height = layout.canvasHeight;
		configureContext(context);
		context.clearRect(0, 0, canvas.width, canvas.height);

		if (layout.hasBackground) {
			context.fillStyle = layout.backgroundColor;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}

		drawGlyphs(context, layout);
		applyPreviewScale(layout);
		canvas.style.display = 'block';
		return layout;
	}

	function applyPreviewScale(layout) {
		const previewScale = 4;
		canvas.style.width = (layout.canvasWidth * previewScale) + 'px';
		canvas.style.height = (layout.canvasHeight * previewScale) + 'px';
	}

	function buildLayout(limitCharacters) {
		const letters = radioDefault.checked ? BUILTIN_LETTERS : (letterInput.value || CUSTOM_DEFAULT_LETTERS);
		const sourceWidth = inputImage.naturalWidth || inputImage.width;
		const sourceHeight = inputImage.naturalHeight || inputImage.height;
		const safeLetterCount = Math.max(letters.length, 1);
		const sourceLetterWidth = sourceWidth > 0 ? sourceWidth / safeLetterCount : 1;
		const sourceLetterHeight = sourceHeight > 0 ? sourceHeight : 1;
		const scale = Number.parseFloat(fontSize.value) || 1;
		const lineGap = Number.parseInt(lineSpacing.value, 10) || 0;
		const charGap = Number.parseInt(characterSpacing.value, 10) || 0;
		const drawWidth = Math.max(1, Math.round(sourceLetterWidth * scale));
		const drawHeight = Math.max(1, Math.round(sourceLetterHeight * scale));
		const maxWidthPixels = Number.parseInt(maxWidth.value, 10) || 0;
		const inputLines = (textInput.value || '').split('\n');
		const glyphs = [];
		const wrappedLines = [];
		let maxX = 0;
		let visibleCharacters = 0;

		// Word-aware wrapping: no mid-word breaks; punctuation stays at end of line
		const PUNCT_NO_LINE_START = '!?,.:;)]}\u2026\u00bb\u2013\u2014';
		inputLines.forEach(function (line) {
			if (maxWidthPixels <= 0) {
				wrappedLines.push(line);
				return;
			}

			if (line.length === 0) {
				wrappedLines.push('');
				return;
			}

			const maxCharsPerLine = Math.max(1, Math.floor((maxWidthPixels + charGap) / (drawWidth + charGap)));
			const words = line.split(' ');
			let currentLine = '';

			words.forEach(function (word) {
				if (currentLine.length === 0) {
					currentLine = word;
					return;
				}

				const candidate = currentLine + ' ' + word;
				const startsWithPunct = word.length > 0 && PUNCT_NO_LINE_START.indexOf(word.charAt(0)) >= 0;

				if (candidate.length <= maxCharsPerLine || startsWithPunct) {
					currentLine = candidate;
				} else {
					wrappedLines.push(currentLine);
					currentLine = word;
				}
			});

			if (currentLine.length > 0) {
				wrappedLines.push(currentLine);
			}
		});

		wrappedLines.forEach(function (line, lineIndex) {
			const fullLineWidth = line.length > 0
				? (line.length * drawWidth) + (Math.max(line.length - 1, 0) * charGap)
				: drawWidth;
			maxX = Math.max(maxX, fullLineWidth);
			let cursorX = 0;
			for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
				if (typeof limitCharacters === 'number' && visibleCharacters >= limitCharacters) {
					break;
				}

				const char = line.charAt(characterIndex);
				const index = letters.indexOf(char);
				glyphs.push({
					index: index,
					isSpace: char === ' ',
					sourceX: Math.max(index, 0) * sourceLetterWidth,
					targetX: cursorX,
					targetY: lineIndex * (drawHeight + lineGap)
				});
				cursorX += drawWidth + charGap;
				visibleCharacters += 1;
			}
		});

		const canvasWidth = Math.max(1, Math.round(maxX || drawWidth));
		const canvasHeight = Math.max(1, Math.round((wrappedLines.length * drawHeight) + (Math.max(wrappedLines.length - 1, 0) * lineGap)));

		return {
			backgroundColor: customBackground.value,
			canvasHeight: canvasHeight,
			canvasWidth: canvasWidth,
			drawHeight: drawHeight,
			drawWidth: drawWidth,
			glyphs: glyphs,
			hasBackground: customBackgroundToggle.checked,
			sourceLetterHeight: sourceLetterHeight,
			sourceLetterWidth: sourceLetterWidth
		};
	}

	function drawGlyphs(targetContext, layout) {
		layout.glyphs.forEach(function (glyph) {
			if (glyph.isSpace || glyph.index < 0) {
				return;
			}

			targetContext.drawImage(
				inputImage,
				glyph.sourceX,
				0,
				layout.sourceLetterWidth,
				layout.sourceLetterHeight,
				glyph.targetX,
				glyph.targetY,
				layout.drawWidth,
				layout.drawHeight
			);
		});
	}



	async function downloadCanvas(type, fileName) {
		try {
			const blob = type === 'image/png'
				? await createIndexedPngBlob(canvas, context)
				: await canvasToBlob(canvas, type, 1);
			downloadBlob(blob, fileName);
			setStatus(fileName + ' exported.');
		} catch (error) {
			setStatus(error.message || 'Export failed.', true);
		}
	}





	function configureContext(targetContext) {
		targetContext.imageSmoothingEnabled = false;
	}



	async function createIndexedPngBlob(targetCanvas, targetContext) {
		const imageData = targetContext.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
		const paletteInfo = buildPaletteFromImageData(imageData);
		if (paletteInfo.palette.length > 256) {
			throw new Error('PNG export requires maximum 256 exact colors from sprite and background.');
		}
		const pngBytes = encodeIndexedPng(targetCanvas.width, targetCanvas.height, paletteInfo);
		return new Blob([pngBytes], { type: 'image/png' });
	}

	function buildPaletteFromImageData(imageData) {
		const palette = [];
		const indices = new Uint8Array(imageData.width * imageData.height);
		const lookup = new Map();
		const data = imageData.data;

		for (let offset = 0, pixelIndex = 0; offset < data.length; offset += 4, pixelIndex += 1) {
			const key = data[offset] + ',' + data[offset + 1] + ',' + data[offset + 2] + ',' + data[offset + 3];
			let paletteIndex = lookup.get(key);
			if (paletteIndex === undefined) {
				paletteIndex = palette.length;
				lookup.set(key, paletteIndex);
				palette.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
			}
			indices[pixelIndex] = paletteIndex;
		}

		return { indices: indices, palette: palette };
	}

	function encodeIndexedPng(width, height, paletteInfo) {
		const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const ihdrData = new Uint8Array(13);
		writeUInt32(ihdrData, 0, width);
		writeUInt32(ihdrData, 4, height);
		ihdrData[8] = 8;
		ihdrData[9] = 3;
		ihdrData[10] = 0;
		ihdrData[11] = 0;
		ihdrData[12] = 0;

		const plteData = new Uint8Array(paletteInfo.palette.length * 3);
		const trnsData = [];
		let lastAlphaIndex = -1;
		paletteInfo.palette.forEach(function (color, index) {
			const baseOffset = index * 3;
			plteData[baseOffset] = color[0];
			plteData[baseOffset + 1] = color[1];
			plteData[baseOffset + 2] = color[2];
			trnsData[index] = color[3];
			if (color[3] !== 255) {
				lastAlphaIndex = index;
			}
		});

		const indexedScanlines = new Uint8Array((width + 1) * height);
		for (let row = 0; row < height; row += 1) {
			const rowOffset = row * (width + 1);
			indexedScanlines[rowOffset] = 0;
			indexedScanlines.set(paletteInfo.indices.subarray(row * width, (row + 1) * width), rowOffset + 1);
		}

		const chunks = [
			pngSignature,
			createPngChunk('IHDR', ihdrData),
			createPngChunk('PLTE', plteData)
		];

		if (lastAlphaIndex >= 0) {
			chunks.push(createPngChunk('tRNS', Uint8Array.from(trnsData.slice(0, lastAlphaIndex + 1))));
		}

		chunks.push(createPngChunk('IDAT', zlibStore(indexedScanlines)));
		chunks.push(createPngChunk('IEND', new Uint8Array(0)));
		return concatUint8Arrays(chunks);
	}

	function createPngChunk(type, data) {
		const typeBytes = textEncoder.encode(type);
		const chunk = new Uint8Array(12 + data.length);
		writeUInt32(chunk, 0, data.length);
		chunk.set(typeBytes, 4);
		chunk.set(data, 8);
		writeUInt32(chunk, data.length + 8, crc32(concatUint8Arrays([typeBytes, data])));
		return chunk;
	}

	function zlibStore(data) {
		const blocks = [new Uint8Array([120, 1])];
		let offset = 0;
		while (offset < data.length) {
			const blockSize = Math.min(65535, data.length - offset);
			const isFinal = offset + blockSize >= data.length;
			const block = new Uint8Array(5 + blockSize);
			block[0] = isFinal ? 1 : 0;
			block[1] = blockSize & 255;
			block[2] = (blockSize >>> 8) & 255;
			const complement = 65535 - blockSize;
			block[3] = complement & 255;
			block[4] = (complement >>> 8) & 255;
			block.set(data.subarray(offset, offset + blockSize), 5);
			blocks.push(block);
			offset += blockSize;
		}

		const adlerBytes = new Uint8Array(4);
		writeUInt32(adlerBytes, 0, adler32(data));
		blocks.push(adlerBytes);
		return concatUint8Arrays(blocks);
	}

	function adler32(data) {
		let a = 1;
		let b = 0;
		for (let index = 0; index < data.length; index += 1) {
			a = (a + data[index]) % 65521;
			b = (b + a) % 65521;
		}
		return ((b << 16) | a) >>> 0;
	}

	function createCrcTable() {
		const table = new Uint32Array(256);
		for (let index = 0; index < 256; index += 1) {
			let value = index;
			for (let bit = 0; bit < 8; bit += 1) {
				value = (value & 1) ? (3988292384 ^ (value >>> 1)) : (value >>> 1);
			}
			table[index] = value >>> 0;
		}
		return table;
	}

	function crc32(data) {
		let value = 4294967295;
		for (let index = 0; index < data.length; index += 1) {
			value = crcTable[(value ^ data[index]) & 255] ^ (value >>> 8);
		}
		return (value ^ 4294967295) >>> 0;
	}

	function writeUInt32(target, offset, value) {
		target[offset] = (value >>> 24) & 255;
		target[offset + 1] = (value >>> 16) & 255;
		target[offset + 2] = (value >>> 8) & 255;
		target[offset + 3] = value & 255;
	}

	function concatUint8Arrays(parts) {
		let totalLength = 0;
		parts.forEach(function (part) {
			totalLength += part.length;
		});

		const merged = new Uint8Array(totalLength);
		let offset = 0;
		parts.forEach(function (part) {
			merged.set(part, offset);
			offset += part.length;
		});
		return merged;
	}

	function canvasToBlob(targetCanvas, type, quality) {
		return new Promise(function (resolve, reject) {
			targetCanvas.toBlob(function (blob) {
				if (!blob) {
					reject(new Error('Export failed. Browser could not create blob.'));
					return;
				}
				resolve(blob);
			}, type, quality);
		});
	}

	function downloadBlob(blob, fileName) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		window.setTimeout(function () {
			URL.revokeObjectURL(url);
		}, 1000);
	}



	function updateSourceMode() {
		customImage.style.display = radioCustom.checked ? 'block' : 'none';
		if (radioDefault.checked) {
			if (letterInput.value !== BUILTIN_LETTERS) {
				lastCustomLetters = letterInput.value || lastCustomLetters;
			}
			letterInput.value = BUILTIN_LETTERS;
			return;
		}

		if (letterInput.value === BUILTIN_LETTERS) {
			letterInput.value = lastCustomLetters || CUSTOM_DEFAULT_LETTERS;
		}
	}

	function updateSettingLabels() {
		fontSizeValue.textContent = (Number.parseFloat(fontSize.value) || 1).toFixed(1) + 'x';
		lineSpacingValue.textContent = (Number.parseInt(lineSpacing.value, 10) || 0) + ' px';
		characterSpacingValue.textContent = (Number.parseInt(characterSpacing.value, 10) || 0) + ' px';
		const maxWidthPixels = Number.parseInt(maxWidth.value, 10) || 0;
		maxWidthValue.textContent = maxWidthPixels > 0 ? maxWidthPixels + ' px' : 'Unlimited';
	}

	function saveSettings() {
		const settings = {
			characterSpacing: characterSpacing.value,
			customLetters: lastCustomLetters,
			customBackground: customBackground.value,
			customBackgroundToggle: customBackgroundToggle.checked,
			fontSize: fontSize.value,
			lineSpacing: lineSpacing.value,
			maxWidth: maxWidth.value,
			sourceMode: radioCustom.checked ? 'custom' : 'default',
			text: textInput.value
		};

		if (radioCustom.checked) {
			settings.letters = letterInput.value;
		}

		if (radioCustom.checked && currentImageDataUrl && currentImageDataUrl.startsWith('data:image/')) {
			settings.customImageDataUrl = currentImageDataUrl;
		}

		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}

	function loadSettings() {
		const rawSettings = window.localStorage.getItem(STORAGE_KEY);
		if (!rawSettings) {
			return;
		}

		try {
			const settings = JSON.parse(rawSettings);
			textInput.value = settings.text || textInput.value;
			lastCustomLetters = settings.customLetters || settings.letters || CUSTOM_DEFAULT_LETTERS;
			letterInput.value = lastCustomLetters;
			fontSize.value = settings.fontSize || fontSize.value;
			lineSpacing.value = settings.lineSpacing || lineSpacing.value;
			characterSpacing.value = settings.characterSpacing || characterSpacing.value;
			maxWidth.value = settings.maxWidth || maxWidth.value;
			customBackgroundToggle.checked = Boolean(settings.customBackgroundToggle);
			customBackground.value = settings.customBackground || customBackground.value;
			radioCustom.checked = settings.sourceMode === 'custom';
			radioDefault.checked = !radioCustom.checked;

			if (settings.customImageDataUrl) {
				currentImageDataUrl = settings.customImageDataUrl;
				inputImage.src = currentImageDataUrl;
			}
		} catch (error) {
			console.warn('Could not restore settings', error);
		}
	}

	function setStatus(message, isError) {
		statusMessage.textContent = message;
		statusMessage.style.color = isError ? '#a63c3c' : '';
	}

	window.generateImage = renderCanvas;

	letterInput.addEventListener('input', function () {
		if (radioCustom.checked) {
			lastCustomLetters = letterInput.value || CUSTOM_DEFAULT_LETTERS;
		}
	});
});
