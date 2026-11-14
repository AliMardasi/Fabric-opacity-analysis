"""Reproduce the original image metrics and inspect the reference crop.

Dependencies: numpy, opencv-python, scikit-image, matplotlib.
Pass the exact reference and sample JPEGs from the original run.
"""

import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
from skimage.metrics import structural_similarity


def read_gray(path):
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"Could not read {path}")
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def reference_crop(shape):
    height, width = shape
    x, y = round(width * 0.25), round(height * 0.52)
    w, h = round(width * 0.50), round(height * 0.40)
    return np.s_[y:y + h, x:x + w]


def gradient(image):
    gx = cv2.Sobel(image, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(image, cv2.CV_64F, 0, 1, ksize=3)
    return np.hypot(gx, gy)


def compare(reference, samples):
    ref = read_gray(reference)
    crop = reference_crop(ref.shape)
    ref = ref[crop]
    if min(ref.shape) < 11 or ref.max() == ref.min():
        raise ValueError("The reference crop needs at least 11 × 11 pixels and nonzero contrast.")
    ref_normalized = ref / ref.mean()
    data_range = float(np.ptp(ref_normalized))
    fig, axes = plt.subplots(len(samples), 4, squeeze=False, figsize=(14, 3.3 * len(samples)))
    for row, path in zip(axes, samples):
        image = read_gray(path)[crop]
        if image.shape != ref.shape or not image.any():
            raise ValueError(f"{path.name} has an incomplete or entirely black crop.")
        normalized = image / image.mean()
        score, ssim_map = structural_similarity(
            normalized, ref_normalized, data_range=data_range,
            gaussian_weights=True, sigma=1.5, use_sample_covariance=False, full=True,
        )
        acutance = gradient(image / 255.0).mean()
        lo, hi = float(image.min()), float(image.max())
        contrast = (hi - lo) / (hi + lo)
        near_black = 100 * np.mean(image <= 5)
        at_zero = 100 * np.mean(image == 0)
        print(f"{path.name}: SSIM {score:.6f} | Acutance {acutance:.6f} | "
              f"Michelson {contrast:.6f} | Pixels ≤5 {near_black:.2f}% | Pixels =0 {at_zero:.2f}%")

        # Smoothed gradients help show larger object edges. Use a shared display scale.
        ref_edges = gradient(cv2.GaussianBlur(ref_normalized, (0, 0), 2))
        sample_edges = gradient(cv2.GaussianBlur(normalized, (0, 0), 2))
        scale = max(np.percentile(ref_edges, 99), np.percentile(sample_edges, 99), 1e-12)
        overlay = np.clip(np.stack((ref_edges, sample_edges, sample_edges), axis=-1) / scale, 0, 1)

        row[0].imshow(ref, cmap="gray", vmin=0, vmax=255)
        row[0].set_title("No-fabric reference")
        row[1].imshow(image, cmap="gray", vmin=0, vmax=255)
        row[1].set_title(path.stem, fontsize=10)
        row[2].imshow(overlay)
        row[2].set_title("Edges · reference red, sample cyan")
        row[3].imshow(ssim_map, cmap="viridis", vmin=0, vmax=1)
        row[3].set_title("Local SSIM · darker is lower")
        for axis in row:
            axis.axis("off")
    fig.tight_layout()
    return fig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, help="Original no-fabric reference JPEG")
    parser.add_argument("samples", nargs="+", type=Path, help="Exact sample JPEG paths")
    parser.add_argument("--output", type=Path, help="Save the comparison figure as a PNG")
    args = parser.parse_args()
    try:
        fig = compare(args.reference, args.samples)
    except ValueError as error:
        parser.error(str(error))
    if args.output:
        fig.savefig(args.output, dpi=150, bbox_inches="tight")
    else:
        plt.show()


if __name__ == "__main__":
    main()
