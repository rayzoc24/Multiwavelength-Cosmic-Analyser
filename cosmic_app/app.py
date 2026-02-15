from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import cv2
import numpy as np
import time
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads"), exist_ok=True)
# Outputs will now be in static/outputs
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'outputs'), exist_ok=True)

app = Flask(__name__)

# Ensure paths are absolute and relative to this script file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# If static folder is not adjacent to app.py, Flask configuration might need tweaks.
# But assuming standard struct: cosmic_app/static/outputs
OUTPUT_FOLDER = os.path.join(BASE_DIR, 'static', 'outputs')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

WIEN_B = 2.898e-3

def wien_lambda_max(temperature_k):
    return WIEN_B / temperature_k

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/wien', methods=['POST'])
def wien_law():
    payload = request.get_json(silent=True) or {}
    try:
        temperature = float(payload.get('temperature', 5000))
    except (TypeError, ValueError):
        temperature = 5000.0

    temperature = max(100.0, temperature)
    lambda_max = wien_lambda_max(temperature)

    graph_t = np.linspace(1000, 10000, 100, dtype=np.float32)
    graph_lambda = WIEN_B / graph_t

    return jsonify({
        'lambda_max': float(lambda_max),
        'temperature': float(temperature),
        'graph_T': graph_t.tolist(),
        'graph_lambda': graph_lambda.tolist()
    })

@app.route('/intensity', methods=['POST'])
def intensity_curve():
    payload = request.get_json(silent=True) or {}
    try:
        temperature = float(payload.get('temperature', 5000))
    except (TypeError, ValueError):
        temperature = 5000.0

    temperature = max(100.0, temperature)

    wavelengths_nm = np.linspace(100, 3000, 200, dtype=np.float32)
    wavelengths_m = wavelengths_nm * 1e-9
    c2 = 1.4388e-2

    with np.errstate(over='ignore', divide='ignore', invalid='ignore'):
        exponent = c2 / (wavelengths_m * temperature)
        intensity = 1.0 / (np.power(wavelengths_m, 5) * (np.exp(exponent) - 1.0))

    intensity = np.nan_to_num(intensity, nan=0.0, posinf=0.0, neginf=0.0)
    max_intensity = float(intensity.max()) if intensity.size else 1.0
    if max_intensity > 0:
        intensity = intensity / max_intensity

    return jsonify({
        'temperature': float(temperature),
        'wavelengths_nm': wavelengths_nm.tolist(),
        'intensities': intensity.tolist()
    })

@app.route('/process', methods=['POST'])
def process_image():
    file = request.files.get('image')
    if file is None:
        return jsonify({'error': 'No image file provided'}), 400

    mode = request.form.get('mode', 'optical')
    clusters_raw = request.form.get('clusters')
    user_clusters = None
    if clusters_raw not in (None, ''):
        try:
            user_clusters = int(clusters_raw)
        except ValueError:
            user_clusters = None

    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    img = cv2.imread(filepath)
    if img is None:
        return jsonify({'error': 'Failed to read image'}), 400
    # Resize while preserving aspect ratio (fit within 512x512).
    height, width = img.shape[:2]
    scale = min(512 / float(width), 512 / float(height))
    new_width = max(1, int(width * scale))
    new_height = max(1, int(height * scale))
    img = cv2.resize(img, (new_width, new_height))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Reduce noise before clustering.
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    # Build multi-wavelength channels for more meaningful clustering.
    optical = gray.astype(np.float32)
    infrared = (0.6 * img[:, :, 2] + 0.4 * img[:, :, 1]).astype(np.float32)
    xray = np.clip(gray * 1.5, 0, 255).astype(np.float32)

    # Select a processed view for display with enhanced visualization.
    if mode == 'infrared':
        processed_gray = infrared.astype(np.uint8)
        processed_view = cv2.applyColorMap(processed_gray, cv2.COLORMAP_INFERNO)
        # Enhance contrast
        processed_view = cv2.convertScaleAbs(processed_view, alpha=1.2, beta=10)
    elif mode == 'xray':
        processed_gray = xray.astype(np.uint8)
        processed_view = cv2.applyColorMap(processed_gray, cv2.COLORMAP_PLASMA)
        # Enhance contrast
        processed_view = cv2.convertScaleAbs(processed_view, alpha=1.2, beta=10)
    else:
        # Apply subtle enhancement to optical mode
        processed_view = cv2.convertScaleAbs(img, alpha=1.15, beta=5)

    # Multi-channel input for KMeans.
    multi = np.stack([optical, infrared, xray], axis=-1)
    pixels = multi.reshape(-1, 3)

    # Determine best K using silhouette score unless user overrides it.
    best_k = 3
    if pixels.shape[0] >= 50:
        k_min, k_max = 2, 10
        if user_clusters is None:
            best_score = -1.0
            sample_size = min(2000, pixels.shape[0])
            for k in range(k_min, k_max + 1):
                if pixels.shape[0] <= k:
                    continue
                try:
                    kmeans_try = KMeans(n_clusters=k, random_state=0, n_init=10)
                    labels_try = kmeans_try.fit_predict(pixels)
                    score = silhouette_score(pixels, labels_try, sample_size=sample_size, random_state=0)
                    if score > best_score:
                        best_score = score
                        best_k = k
                except Exception:
                    continue
        else:
            best_k = max(k_min, min(user_clusters, k_max))

    # --- Segmentation ---
    kmeans = KMeans(n_clusters=best_k, random_state=0, n_init=10)
    labels = kmeans.fit_predict(pixels)
    segmented = labels.reshape(new_height, new_width)

    # Compute cluster interpretations
    cluster_info = {}
    for cluster_id in range(best_k):
        # Get all pixels belonging to this cluster
        cluster_mask = labels == cluster_id
        cluster_pixels = pixels[cluster_mask]
        
        if len(cluster_pixels) > 0:
            # Compute average values for this cluster
            avg_optical = float(np.mean(cluster_pixels[:, 0]))
            avg_infrared = float(np.mean(cluster_pixels[:, 1]))
            avg_xray = float(np.mean(cluster_pixels[:, 2]))
            
            # Determine dominant characteristic
            max_val = max(avg_optical, avg_infrared, avg_xray)
            
            # Assign label based on dominant characteristic
            if max_val < 50:  # Low overall intensity
                label = "Dark Space"
                description = "Low energy regions with minimal emissions"
                icon = "🌌"
            elif avg_optical == max_val and avg_optical > 150:
                label = "Bright Regions (Stars)"
                description = "High optical brightness indicating stellar objects"
                icon = "⭐"
            elif avg_infrared == max_val:
                label = "Dust / Nebula"
                description = "Strong infrared signature from dust and gas clouds"
                icon = "🌫️"
            elif avg_xray == max_val:
                label = "High Energy Regions"
                description = "Intense X-ray emissions from energetic processes"
                icon = "💥"
            else:
                label = "Medium Intensity"
                description = "Moderate energy emissions across wavelengths"
                icon = "🔆"
            
            cluster_info[cluster_id] = {
                'label': label,
                'description': description,
                'icon': icon,
                'avg_optical': round(avg_optical, 1),
                'avg_infrared': round(avg_infrared, 1),
                'avg_xray': round(avg_xray, 1)
            }

    # Normalize segmentation for visualization and apply a color map.
    seg_norm = (segmented / segmented.max() * 255).astype(np.uint8)
    segmented_color = cv2.applyColorMap(seg_norm, cv2.COLORMAP_JET)

    filename_suffix = str(int(time.time()))
    processed_filename = f"processed_{filename_suffix}.png"
    segmented_filename = f"segmented_{filename_suffix}.png"

    processed_path = os.path.join(OUTPUT_FOLDER, processed_filename)
    segmented_path = os.path.join(OUTPUT_FOLDER, segmented_filename)
    
    cv2.imwrite(processed_path, processed_view)
    cv2.imwrite(segmented_path, segmented_color)
    
    print("Saved processed image at:", processed_path)
    print("Saved segmented image at:", segmented_path)

    return jsonify({
        'best_k': int(best_k),
        'processed_url': f'/static/outputs/{processed_filename}',
        'segmented_url': f'/static/outputs/{segmented_filename}',
        'cluster_info': cluster_info
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
    print("Starting Flask on port:", port)
