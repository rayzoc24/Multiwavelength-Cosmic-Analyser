let chartInstance = null;
let graphMode = 'wien';
let userOverrideClusters = false;
let currentZoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;

function openImageModal(imgElement) {
    if (!imgElement || !imgElement.src) {
        return;
    }

    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    if (!modal || !modalImage) {
        return;
    }

    modalImage.src = imgElement.src;
    currentZoom = 1;
    panX = 0;
    panY = 0;
    updateImageTransform();
    modalImage.style.cursor = 'default';
    modal.classList.add('active');
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function zoomImage(factor) {
    const modalImage = document.getElementById('modalImage');
    if (!modalImage) {
        return;
    }

    currentZoom = Math.min(4, Math.max(0.5, currentZoom * factor));
    updateImageTransform();
    
    // Update cursor based on zoom level
    if (currentZoom > 1) {
        modalImage.style.cursor = 'grab';
    } else {
        modalImage.style.cursor = 'default';
    }
}

function resetZoom() {
    const modalImage = document.getElementById('modalImage');
    if (!modalImage) {
        return;
    }

    currentZoom = 1;
    panX = 0;
    panY = 0;
    updateImageTransform();
    modalImage.style.cursor = 'default';
}

function updateImageTransform() {
    const modalImage = document.getElementById('modalImage');
    if (!modalImage) {
        return;
    }
    modalImage.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
}

function startPan(event) {
    if (currentZoom <= 1) {
        return;
    }
    isPanning = true;
    startX = event.clientX - panX;
    startY = event.clientY - panY;
    const modalImage = document.getElementById('modalImage');
    if (modalImage) {
        modalImage.style.cursor = 'grabbing';
    }
}

function doPan(event) {
    if (!isPanning) {
        return;
    }
    event.preventDefault();
    panX = event.clientX - startX;
    panY = event.clientY - startY;
    updateImageTransform();
}

function endPan() {
    isPanning = false;
    const modalImage = document.getElementById('modalImage');
    if (modalImage && currentZoom > 1) {
        modalImage.style.cursor = 'grab';
    }
}

function updateTemperatureValue(value) {
    const label = document.getElementById('temperatureValue');
    if (label) {
        label.textContent = `${value} K`;
    }
}

function updateClusterValue(value) {
    const label = document.getElementById('clusterValue');
    if (label) {
        label.textContent = value;
    }
}

function previewUploadedImage() {
    const fileInput = document.getElementById('imageInput');
    const originalPreview = document.getElementById('originalPreview');
    const fileUploadText = document.getElementById('fileUploadText');

    if (!fileInput.files[0]) {
        originalPreview.removeAttribute('src');
        if (fileUploadText) {
            fileUploadText.textContent = 'Choose Image File';
        }
        return;
    }

    const fileName = fileInput.files[0].name;
    if (fileUploadText) {
        fileUploadText.textContent = fileName.length > 30 ? fileName.substring(0, 27) + '...' : fileName;
    }
    originalPreview.src = URL.createObjectURL(fileInput.files[0]);
}

function generateGraph() {
    const temperatureInput = document.getElementById('temperatureInput');
    const temperature = parseFloat(temperatureInput.value || 5000);
    
    // Debug logging
    console.log('Selected Temperature:', temperature, 'K');

    if (graphMode === 'intensity') {
        fetchIntensity(temperature);
        return;
    }

    fetch('/wien', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: temperature })
    })
    .then(res => res.json())
    .then(data => {
        drawWienGraph(data.graph_T, data.graph_lambda, temperature);
    })
    .catch(() => {
        drawWienGraph([], [], temperature);
    });
}

function fetchIntensity(temperature) {
    fetch('/intensity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: temperature })
    })
    .then(res => res.json())
    .then(data => {
        drawIntensityGraph(data.wavelengths_nm, data.intensities, temperature);
    })
    .catch(() => {
        drawIntensityGraph([], [], temperature);
    });
}

function drawWienGraph(temps, wavelengths, selectedTemp) {
    const ctx = document.getElementById('graphCanvas').getContext('2d');

    // Ensure selectedTemp is a valid number
    selectedTemp = parseFloat(selectedTemp);
    console.log('Drawing Wien graph for temperature:', selectedTemp, 'K');

    // Wien's constant
    const WIEN_B = 2.898e-3;
    
    // Calculate exact wavelength for selected temperature
    const selectedWavelength = WIEN_B / selectedTemp;

    // Create x-y data points for the curve (convert meters to nanometers for display)
    const curveData = temps.map((t, i) => ({
        x: t,
        y: wavelengths[i] * 1e9  // Convert m to nm
    }));

    // Create highlight point for selected temperature (convert to nanometers)
    const highlightData = [{
        x: selectedTemp,
        y: selectedWavelength * 1e9  // Convert m to nm
    }];

    const verticalLinePlugin = {
        id: 'verticalLinePlugin',
        afterDraw(chart) {
            if (!Number.isFinite(selectedTemp)) {
                return;
            }

            const { ctx: canvasContext, chartArea, scales } = chart;
            const x = scales.x.getPixelForValue(selectedTemp);

            canvasContext.save();
            canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            canvasContext.lineWidth = 1;
            canvasContext.setLineDash([4, 6]);
            canvasContext.beginPath();
            canvasContext.moveTo(x, chartArea.top);
            canvasContext.lineTo(x, chartArea.bottom);
            canvasContext.stroke();
            canvasContext.restore();
        }
    };

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Wavelength (m)',
                    data: curveData,
                    borderColor: '#36c9f4',
                    backgroundColor: 'rgba(54, 201, 244, 0.2)',
                    borderWidth: 2,
                    pointRadius: 0,
                    showLine: true,
                    tension: 0.3
                },
                {
                    label: 'Selected Point',
                    data: highlightData,
                    borderColor: '#ffd166',
                    backgroundColor: '#ffd166',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Temperature vs Wavelength'
                },
                tooltip: {
                    callbacks: {
                        title(context) {
                            // Get temperature from the data point
                            const dataPoint = context[0];
                            if (!dataPoint) return 'Temperature: N/A';
                            
                            const tempValue = dataPoint.parsed?.x || dataPoint.raw?.x;
                            if (tempValue !== undefined && tempValue !== null) {
                                return `Temperature: ${Math.round(tempValue)} K`;
                            }
                            return 'Temperature: N/A';
                        },
                        label(context) {
                            // Get wavelength from the data point (already in nm)
                            const wavelengthValue = context.parsed?.y || context.raw?.y;
                            if (wavelengthValue !== undefined && wavelengthValue !== null) {
                                return `Wavelength: ${wavelengthValue.toFixed(2)} nm`;
                            }
                            return 'Wavelength: N/A';
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Temperature (K)' }
                },
                y: {
                    type: 'linear',
                    title: { display: true, text: 'Wavelength (nm)' }
                }
            }
        },
        plugins: [verticalLinePlugin]
    });
}

function drawIntensityGraph(wavelengths, intensities, temperature) {
    const ctx = document.getElementById('graphCanvas').getContext('2d');

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: wavelengths,
            datasets: [
                {
                    label: 'Intensity (normalized)',
                    data: intensities,
                    borderColor: '#ff8fab',
                    backgroundColor: 'rgba(255, 143, 171, 0.2)',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.35
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: `Intensity vs Wavelength (T=${temperature} K)`
                },
                tooltip: {
                    callbacks: {
                        title(context) {
                            const value = context[0]?.label;
                            return `Wavelength: ${value} nm`;
                        },
                        label(context) {
                            const value = context.parsed?.y;
                            return `Intensity: ${value}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Wavelength (nm)' }
                },
                y: {
                    title: { display: true, text: 'Intensity (normalized)' }
                }
            }
        }
    });
}

function setGraphMode(mode) {
    graphMode = mode === 'intensity' ? 'intensity' : 'wien';
    const wienToggle = document.getElementById('wienToggle');
    const intensityToggle = document.getElementById('intensityToggle');

    if (wienToggle && intensityToggle) {
        wienToggle.classList.toggle('active', graphMode === 'wien');
        intensityToggle.classList.toggle('active', graphMode === 'intensity');
    }

    generateGraph();
}

function processImage() {
    const fileInput = document.getElementById('imageInput');
    const mode = document.getElementById('mode').value;
    const clusters = document.getElementById('clusters').value;
    const processedPreview = document.getElementById('processedImg');
    const segmentedPreview = document.getElementById('segmentedImg');
    const loadingIndicator = document.querySelector('.loading-indicator');
    const overlay = document.getElementById('processingOverlay');
    const suggestedK = document.getElementById('suggestedK');

    if (!fileInput.files[0]) {
        return;
    }

    if (loadingIndicator) {
        loadingIndicator.classList.add('active');
    }
    if (overlay) {
        overlay.classList.add('active');
    }
    document.body.classList.add('processing');

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('mode', mode);
    if (userOverrideClusters) {
        formData.append('clusters', clusters);
    }

    fetch('/process', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        console.log('Process response:', data);
        const cacheBust = "?t=" + new Date().getTime();
        
        // Update image sources with cache busting
        if (data.processed_url) {
            processedPreview.src = data.processed_url + cacheBust;
        }
        if (data.segmented_url) {
            segmentedPreview.src = data.segmented_url + cacheBust;
        }
        // Keep suggested K as "3-4" range, but update slider if not overridden
        if (data.best_k && !userOverrideClusters) {
            const clusterInput = document.getElementById('clusters');
            if (clusterInput) {
                clusterInput.value = data.best_k;
                updateClusterValue(clusterInput.value);
            }
        }
        // Update analysis panel with cluster interpretations
        const analysisPanel = document.getElementById('analysisPanel');
        const clusterList = document.getElementById('clusterList');
        if (data.cluster_info && clusterList) {
            // JET colormap colors (approximation for visualization)
            const jetColors = [
                '#0000ff', // Blue
                '#00ffff', // Cyan
                '#00ff00', // Green
                '#ffff00', // Yellow
                '#ff0000'  // Red
            ];
            
            // Build cluster interpretation cards
            const clusterCards = Object.keys(data.cluster_info)
                .sort((a, b) => Number(a) - Number(b))
                .map(clusterId => {
                    const info = data.cluster_info[clusterId];
                    const colorIndex = Math.min(Number(clusterId), jetColors.length - 1);
                    const clusterColor = jetColors[colorIndex];
                    
                    return `
                        <div class="cluster-interpretation-card">
                            <div class="cluster-card-header">
                                <span class="cluster-color-dot" style="background: ${clusterColor};"></span>
                                <span class="cluster-card-icon">${info.icon}</span>
                                <span class="cluster-card-title">Cluster ${Number(clusterId) + 1}</span>
                            </div>
                            <div class="cluster-card-body">
                                <div class="cluster-card-label">${info.label}</div>
                                <div class="cluster-card-description">${info.description}</div>
                                <div class="cluster-card-stats">
                                    <span title="Optical"><span class="stat-icon">🔆</span> ${info.avg_optical}</span>
                                    <span title="Infrared"><span class="stat-icon">🌡️</span> ${info.avg_infrared}</span>
                                    <span title="X-ray"><span class="stat-icon">⚡</span> ${info.avg_xray}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            
            clusterList.innerHTML = clusterCards;
            
            if (analysisPanel) {
                analysisPanel.style.display = 'block';
                // Trigger animation
                analysisPanel.classList.remove('fade-in');
                setTimeout(() => analysisPanel.classList.add('fade-in'), 10);
            }
        }
        if (loadingIndicator) {
            loadingIndicator.classList.remove('active');
        }
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.classList.remove('processing');
    })
    .catch(error => {
        console.error('Process error:', error);
        processedPreview.removeAttribute('src');
        segmentedPreview.removeAttribute('src');
        if (loadingIndicator) {
            loadingIndicator.classList.remove('active');
        }
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.classList.remove('processing');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const temperatureInput = document.getElementById('temperatureInput');
    const clusterInput = document.getElementById('clusters');
    const imageModal = document.getElementById('imageModal');

    if (temperatureInput) {
        updateTemperatureValue(temperatureInput.value);
        temperatureInput.addEventListener('input', (event) => {
            updateTemperatureValue(event.target.value);
            generateGraph();
        });
    }

    if (clusterInput) {
        updateClusterValue(clusterInput.value);
        clusterInput.addEventListener('input', (event) => {
            userOverrideClusters = true;
            updateClusterValue(event.target.value);
        });
    }

    const modalImage = document.getElementById('modalImage');
    if (modalImage) {
        modalImage.addEventListener('mousedown', startPan);
        modalImage.addEventListener('mousemove', doPan);
        modalImage.addEventListener('mouseup', endPan);
        modalImage.addEventListener('mouseleave', endPan);
    }

    if (imageModal) {
        imageModal.addEventListener('click', (event) => {
            if (event.target === imageModal) {
                closeImageModal();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeImageModal();
        }
    });

    generateGraph();
});
