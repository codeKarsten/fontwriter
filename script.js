document.addEventListener('DOMContentLoaded', function () {
	const textInput = document.getElementById('textInput');
	const imageInput = document.getElementById('imageInput');
	const inputImage = document.getElementById('inputImage');
	const letterInput = document.getElementById('letterInput');
	const customBackgroundToggle = document.getElementById('customBackgroundToggle');
	const customBackground = document.getElementById('customBackground');
	const canvas = document.getElementById('outputCanvas');
	const context = canvas.getContext('2d');

	imageInput.addEventListener('change', function (event) {
		const file = event.target.files[0];
		const reader = new FileReader();

		reader.onload = function (e) {
			inputImage.src = e.target.result;
			inputImage.style.display = 'block';
		};

		reader.readAsDataURL(file);
	});

	document.getElementById('generateButton').addEventListener('click', generateImage);

	function generateImage() {
		const text = textInput.value;
		const letterInputValue = letterInput.value;
		const letterWidth = inputImage.width / letterInputValue.length;
		const letterHeight = inputImage.height;
		const lines = text.split('\n');
		let maxWidth = 0;

		lines.forEach(function (line) {
			maxWidth = Math.max(maxWidth, line.length);
		});

		canvas.width = maxWidth * letterWidth;
		canvas.height = lines.length * letterHeight;
		context.clearRect(0, 0, canvas.width, canvas.height);
		if (customBackgroundToggle.checked) {
			context.fillStyle = customBackground.value;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}

		lines.forEach(function (line, index) {
			let pos = 0;
			for (let i = 0; i < line.length; i++) {
				const char = line.charAt(i);
				const charIndex = getCharIndex(char, letterInputValue);
				if (char === ' ' || charIndex !== -1) {
					context.drawImage(inputImage, charIndex * letterWidth, 0, letterWidth, letterHeight, pos * letterWidth, index * letterHeight, letterWidth, letterHeight);
				}
				pos++;
			}
		});

		canvas.style.display = 'block';
	}

	function getCharIndex(char, letterInput) {
		return letterInput.indexOf(char);
	}

	window.generateImage = generateImage; // Make the function accessible globally
});
