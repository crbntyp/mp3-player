// Audio Visualizer with Pulse Line (Heart Rate Monitor Style)
class AudioVisualizer {
    constructor() {
        this.canvas = document.getElementById('visualizer-canvas');
        this.ctx = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isActive = false;
        this.animationId = null;
        this.colors = {
            primary: '#6366f1',
            secondary: '#4f46e5',
            accent: '#a78bfa'
        };

        // Waveform history for smooth animation
        this.waveformHistory = [];
        this.maxHistory = 100; // Keep last 100 frames

        this.init();
    }

    init() {
        if (!this.canvas) {
            console.warn('Visualizer canvas not found');
            return;
        }

        // Set up 2D canvas context
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Handle window resize
        window.addEventListener('resize', () => this.resizeCanvas());

        console.log('🎨 Pulse line visualizer initialized');
    }

    resizeCanvas() {
        if (!this.canvas) return;

        const width = this.canvas.offsetWidth || 300;
        const height = this.canvas.offsetHeight || 300;

        // Set canvas size with device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        // Scale context to match DPR
        this.ctx.scale(dpr, dpr);

        // Set canvas style size
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
    }

    connectAudio(audioElement) {
        if (!audioElement) {
            console.warn('No audio element provided');
            return;
        }

        try {
            // Create audio context if it doesn't exist
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 512; // Good balance for waveform
                this.analyser.smoothingTimeConstant = 0.8; // Smooth transitions

                const source = this.audioContext.createMediaElementSource(audioElement);
                source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);

                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

                console.log('✓ Audio context connected to pulse visualizer');
            }
        } catch (error) {
            console.error('Error connecting audio:', error);
        }
    }

    updateColors(colors) {
        this.colors = colors;
    }

    animate() {
        if (!this.isActive) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        // Clear canvas
        this.clearCanvas();

        // Get audio data
        if (this.analyser && this.dataArray) {
            this.analyser.getByteFrequencyData(this.dataArray);
            this.drawPulseLine();
        } else {
            // Draw idle pulse line when no audio
            this.drawIdlePulse();
        }
    }

    clearCanvas() {
        const width = this.canvas.offsetWidth || 300;
        const height = this.canvas.offsetHeight || 300;
        this.ctx.clearRect(0, 0, width, height);
    }

    drawPulseLine() {
        const width = this.canvas.offsetWidth || 300;
        const height = this.canvas.offsetHeight || 300;
        const centerY = height / 2;

        // Calculate average amplitude for baseline
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;

        // Create waveform data from frequency data
        const waveformData = [];
        const sampleSize = 32; // Use subset of frequency data
        const step = Math.floor(this.dataArray.length / sampleSize);

        for (let i = 0; i < sampleSize; i++) {
            const index = i * step;
            const value = this.dataArray[index] || 0;
            waveformData.push(value);
        }

        // Add to history
        this.waveformHistory.unshift(waveformData);
        if (this.waveformHistory.length > this.maxHistory) {
            this.waveformHistory.pop();
        }

        // Draw multiple lines for trail effect
        for (let h = 0; h < Math.min(this.waveformHistory.length, 5); h++) {
            const historyData = this.waveformHistory[h];
            const opacity = 1 - (h * 0.2); // Fade older lines

            this.ctx.beginPath();
            this.ctx.lineWidth = 3 - (h * 0.4);

            // Start from left edge
            const pointSpacing = width / (historyData.length - 1);

            for (let i = 0; i < historyData.length; i++) {
                const x = i * pointSpacing;
                const value = historyData[i];

                // Create pulse effect - amplify the waveform
                const amplitude = (value / 255) * (height * 0.4);

                // Add some pulse/heartbeat character with sine wave
                const time = Date.now() * 0.003;
                const pulse = Math.sin(i * 0.5 + time) * 5;

                const y = centerY + amplitude * Math.sin(i * 0.3) + pulse;

                if (i === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    // Use quadratic curves for smooth lines
                    const prevX = (i - 1) * pointSpacing;
                    const cpX = (prevX + x) / 2;
                    const cpY = y;
                    this.ctx.quadraticCurveTo(prevX, y, cpX, cpY);
                    this.ctx.lineTo(x, y);
                }
            }

            // Create gradient for glow effect
            const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, this.hexToRgba(this.colors.accent, opacity * 0.3));
            gradient.addColorStop(0.5, this.hexToRgba(this.colors.primary, opacity));
            gradient.addColorStop(1, this.hexToRgba(this.colors.accent, opacity * 0.3));

            this.ctx.strokeStyle = gradient;
            this.ctx.shadowBlur = 10 + (average / 255) * 20;
            this.ctx.shadowColor = this.colors.accent;
            this.ctx.stroke();
        }

        // Draw center baseline with glow
        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);
        this.ctx.lineTo(width, centerY);
        this.ctx.strokeStyle = this.hexToRgba(this.colors.accent, 0.2);
        this.ctx.lineWidth = 1;
        this.ctx.shadowBlur = 5;
        this.ctx.stroke();
    }

    drawIdlePulse() {
        const width = this.canvas.offsetWidth || 300;
        const height = this.canvas.offsetHeight || 300;
        const centerY = height / 2;
        const time = Date.now() * 0.002;

        this.ctx.beginPath();
        this.ctx.lineWidth = 2;

        const points = 50;
        const pointSpacing = width / (points - 1);

        for (let i = 0; i < points; i++) {
            const x = i * pointSpacing;

            // Create gentle idle pulse
            const wave1 = Math.sin(i * 0.1 + time) * 10;
            const wave2 = Math.sin(i * 0.2 - time * 1.5) * 5;
            const y = centerY + wave1 + wave2;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        // Subtle gradient
        const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, this.hexToRgba(this.colors.accent, 0.3));
        gradient.addColorStop(0.5, this.hexToRgba(this.colors.primary, 0.5));
        gradient.addColorStop(1, this.hexToRgba(this.colors.accent, 0.3));

        this.ctx.strokeStyle = gradient;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = this.colors.accent;
        this.ctx.stroke();

        // Center line
        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);
        this.ctx.lineTo(width, centerY);
        this.ctx.strokeStyle = this.hexToRgba(this.colors.accent, 0.1);
        this.ctx.lineWidth = 1;
        this.ctx.shadowBlur = 3;
        this.ctx.stroke();
    }

    hexToRgba(hex, alpha = 1) {
        // Convert hex to rgba
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    show() {
        this.isActive = true;
        this.canvas.style.opacity = '1';
        this.animate();
        console.log('👁️ Pulse visualizer shown');
    }

    hide() {
        this.isActive = false;
        this.canvas.style.opacity = '0';
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        // Clear canvas when hiding
        this.clearCanvas();
        console.log('👁️ Pulse visualizer hidden');
    }

    toggle() {
        if (this.isActive) {
            this.hide();
        } else {
            this.show();
        }
        return this.isActive;
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this.clearCanvas();
    }
}
