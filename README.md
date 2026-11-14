# Fabric visibility project notebooks

| Folder | Notebook | What it does |
| --- | --- | --- |
| `01_spectral_measurements` | [Transmittance.ipynb](01_spectral_measurements/Transmittance.ipynb) | Processes spectrophotometer measurements to calculate absorbance, specular transmission, and D65-weighted luminous transmission. |
| `02_image_analysis` | [Image_analysis.ipynb](02_image_analysis/Image_analysis.ipynb) | Compares fabric photographs with no-fabric references and reports image metrics, estimated transmission, and diagnostic plots. |
| `03_optical_image_statistics` | [Given matlab code.ipynb](03_optical_image_statistics/Given%20matlab%20code.ipynb) | Combines spectral measurements with image metrics and runs correlation, model fitting, validation, and calibration experiments in Python. |

## 1. Spectral measurements

| Notebook section | Analysis | Result |
| --- | --- | --- |
| 1. Set up data access | Mounts Google Drive in Colab. | Access to the configured measurement files |
| 2. Calculate spectral quantities | Calculates absorbance from transmission spectra and specular transmission from total and diffuse spectra. | `absorption_results_combined.xlsx`, an absorbance plot, and `T_specular.xlsx` |
| 3. Calculate luminous specular transmission | Checks the photopic sensitivity samples and weights the specular spectrum from `T_specular.xlsx` using D65 and the photopic curve. | `luminous_transmittance_specular_report.xlsx` |
| 4. Run supplemental optical and image comparisons | Generates a two-lace correlation report and compares image metrics across three photo sets. These blocks also appear in the statistics notebook. | `optical_vs_image_correlation.xlsx` and image comparison plots |

## 2. Image analysis

| Notebook section | Analysis | Result |
| --- | --- | --- |
| 1. Set up data access and the image processor | Mounts Google Drive, configures the references and crop, and defines the image processor. | Settings and processor used by the main pipeline |
| 2. Process the photo sets and export results | Loads, crops, and filters the cabinet and lamp-and-cabinet photos, then calculates metrics for both sets. | `report_cabinet.xlsx`, `report_lamp_cabinet.xlsx`, and metric comparison plots |
| 3. Inspect the prepared images | Calculates local transmission maps, compares histograms, and inspects dark channels for the prepared cabinet images. | Diagnostic plots and airlight estimates |
| 4. Run standalone image checks | Previews the crop, compares mean RGB intensity against the reference, and estimates median per-channel transmission. | Crop previews, intensity ratios, and `transmission_report.xlsx` |

## 3. Optical–image statistics

| Notebook section | Analysis | Result |
| --- | --- | --- |
| 1. Build the optical and image metrics | Combines spectra and photos in two MATLAB ports, lists alternate paths for the full dataset, and plots the nine optical–image pairs. | `nonwoven + 2 lace_report.xlsx`, `optical_vs_image_correlation.xlsx`, and scatter plots |
| 2. Compare and calibrate image metrics | Compares SSIM, acutance, and Michelson contrast across three photo sets and tests how they respond to controlled image distortions. | Metric comparison plots, `calibration_sweep_report.xlsx`, and response curves |
| 3. Explore the full dataset | Computes pairwise correlations and residuals, performs a PCA-style eigenanalysis, and explores how sample removal affects correlations. | `full_correlation_report.xlsx`, `Eigenvectors.xlsx`, and `outlier_removal_report.xlsx` |
| 4. Fit and validate prediction models | Fits linear and power-sum models, evaluates cross-validation and random train/test splits, and compares saved SSIM predictions by sample. | Model fit, train/test, and SSIM comparison reports and plots |

## Inputs and handoffs

- The notebooks point to files under `/content/drive/MyDrive/Master`. The raw spectra, photos, and report workbooks are external to this folder.
- The spectral and image notebooks can be used independently. The combined analysis in the statistics notebook reads spectra and images directly.
- Sections 3–4 expect `all_report.xlsx`, sheet `Per-Sample Values`, for the full-dataset analyses. In section 1, the combined report currently saves `nonwoven + 2 lace_report.xlsx`. Copy the alternate paths into the combined report cell and update its output filename to generate the full-dataset workbook.
- “Plot the nine optical–image pairs” expects `optical_vs_image_correlation(2 lace).xlsx`. The preceding report cell saves `optical_vs_image_correlation.xlsx`.
- “Compare SSIM predictions from the two implementations” expects `ssim_optimization_results.xlsx` alongside the `Pred_SSIM` sheet in `multivariate_report.xlsx`. “Fit power-sum models with SciPy” writes `all_targets_optimization_results.xlsx`.
