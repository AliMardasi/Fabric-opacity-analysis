/**
 * Summarise saved family-held-out predictions without rerunning any fits.
 * Usage: node layer_error_report.mjs multivariate_report.xlsx layer_errors.xlsx
 * All three metrics: --optics all_report.xlsx --metric All
 * The Excel dependency is @oai/artifact-tool (bundled with Codex desktop).
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const METRICS = ['SSIM', 'Acutance', 'Michelson Contrast'];
const GROUPS = ['Base fabric', '+ 1 black', '+ 2 black', 'Other layered', 'Mixed'];
const OPTICAL_COLUMNS = ['weighted_T_dir', 'diffuseness', 'opacity'];
const OPTICAL_LABELS = ['Direct transmittance', 'Diffuseness', 'Opacity'];
const NUMBER_FORMAT = '0.0000;-0.0000;0.0000';

const sampleKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

async function readRows(SpreadsheetFile, FileBlob, path, sheetName, columns) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  const sheet = workbook.worksheets.items.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`${basename(path)} is missing the ${sheetName} sheet.`);
  const [headers = [], ...rows] = sheet.getUsedRange(true)?.values ?? [];
  const indices = columns.map((column) => {
    const index = headers.indexOf(column);
    if (index < 0) throw new Error(`${sheetName} is missing the ${column} column.`);
    return index;
  });
  return rows.filter((row) => row.some((value) => value != null && value !== ''))
    .map((row) => indices.map((index) => row[index]));
}

function identifySample(sample, family) {
  const name = sampleKey(sample);
  const backing = name.match(/\s+on\s+(\S+)$/);
  const layers = name.replace(/\s+on\s+\S+$/, '').match(/\+\s*(\d+)\s*(\S+)$/);
  if (family === 'mixed') return { group: 'Mixed' };
  if (!name.includes('+')) return { group: 'Base fabric' };
  const count = layers ? Number(layers[1]) : null;
  const black = layers?.[2] === 'black';
  const blackGroup = `+ ${count} black`;
  return {
    group: black && GROUPS.includes(blackGroup) ? blackGroup : 'Other layered',
    count,
    black,
    backing: backing?.[1],
  };
}

function indexBySample(rows) {
  const indexed = new Map();
  for (const row of rows) {
    if (!row.sample) throw new Error('A source row has no sample name.');
    const key = sampleKey(row.sample);
    if (indexed.has(key)) throw new Error(`Duplicate sample name ${row.sample}.`);
    indexed.set(key, row);
  }
  return indexed;
}

function addMatchedComparisons(samples) {
  for (const sample of samples.filter((row) => row.black)) {
    const family = samples.filter((row) => row.family === sample.family);
    const bases = family.filter((row) => row.group === 'Base fabric');
    const controls = family.filter((row) => row.group === 'Other layered' && !row.black &&
      row.count === sample.count && row.backing === sample.backing);
    // The difference of residuals equals the measured change minus the predicted change.
    sample.base = bases.length === 1 ? bases[0].sample : null;
    sample.baseGap = sample.base ? sample.linearError - bases[0].linearError : null;
    sample.controlCount = controls.length;
    sample.controlGap = controls.length ? sample.linearError - mean(controls.map((row) => row.linearError)) : null;
  }
}

function addOpticalComparisons(samples, opticalRows) {
  const optics = indexBySample(opticalRows.map(([sample, ...values]) => ({ sample, values })));
  for (const sample of samples) {
    sample.optics = optics.get(sampleKey(sample.sample))?.values;
    if (!sample.optics?.every(Number.isFinite)) {
      throw new Error(`Missing optical values for ${sample.sample} in the Per-Sample Values sheet.`);
    }
  }

  for (const family of new Set(samples.map((row) => row.family))) {
    const training = samples.filter((row) => row.family !== family);
    const ranges = OPTICAL_COLUMNS.map((_, index) => {
      const values = training.map((row) => row.optics[index]);
      const center = mean(values);
      return {
        min: Math.min(...values),
        max: Math.max(...values),
        sd: Math.sqrt(mean(values.map((value) => (value - center) ** 2))),
      };
    });
    for (const sample of samples.filter((row) => row.family === family)) {
      const outside = ranges.flatMap(({ min, max }, index) =>
        sample.optics[index] < min || sample.optics[index] > max ? [OPTICAL_LABELS[index]] : []);
      sample.outside = outside.join(', ') || 'None';
      sample.opacityRange = [ranges[2].min, ranges[2].max];

      let bestDistance = Infinity;
      for (const candidate of training) {
        const distance = Math.hypot(...ranges.map(({ sd }, index) =>
          sd ? (sample.optics[index] - candidate.optics[index]) / sd : 0));
        if (distance < bestDistance) {
          sample.neighbor = candidate.sample;
          sample.distance = distance;
          bestDistance = distance;
        }
      }
    }
  }
}

function formatSheet(sheet, widths) {
  sheet.showGridLines = false;
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function writeTable(sheet, row, headers, rows, numberColumns) {
  const header = sheet.getRangeByIndexes(row - 1, 0, 1, headers.length);
  header.values = [headers];
  header.format = {
    fill: '#243C51', font: { name: 'Arial', bold: true, size: 10, color: '#FFFFFF' },
    horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true, rowHeight: 30,
  };
  if (!rows.length) return;
  const body = sheet.getRangeByIndexes(row, 0, rows.length, headers.length);
  body.values = rows;
  body.format.font = { name: 'Arial', size: 10, color: '#1E2C38' };
  body.format.rowHeight = 18;
  body.format.verticalAlignment = 'center';
  numberColumns.forEach((index) => body.getColumn(index).setNumberFormat(NUMBER_FORMAT));
}

function note(sheet, row, text, bold = false) {
  const cell = sheet.getRange(`A${row}`);
  cell.values = [[text]];
  cell.format.font = { name: 'Arial', size: bold ? 11 : 10, bold, color: '#243C51' };
}

function buildReport(Workbook, samples, metric, predictionsPath, opticsPath) {
  const book = Workbook.create();
  const summary = book.worksheets.add('Summary');
  const details = book.worksheets.add('Samples');
  const summaryWidths = [160, 92, 114, 114, 114, 114, 116];
  if (opticsPath) summaryWidths.push(120);
  formatSheet(summary, summaryWidths);
  summary.tabColor = '#243C51';
  note(summary, 2, `${metric} errors by fabric stack`, true);
  note(summary, 3, `${samples.length} family-held-out predictions. Each fit excluded the sample’s fabric family.`);

  const byGroup = GROUPS.map((group) => samples.filter((sample) => sample.group === group));
  const groupHeaders = ['Fabric stack', 'Samples', 'Linear mean error', 'Power-sum mean error',
    'Linear MAE', 'Power-sum MAE', 'Both predicted too high'];
  if (opticsPath) groupHeaders.push('Outside training range');
  const groupRows = byGroup.map((rows, index) => {
    const result = [GROUPS[index], rows.length,
      mean(rows.map((row) => row.linearError)), mean(rows.map((row) => row.powerError)),
      mean(rows.map((row) => Math.abs(row.linearError))), mean(rows.map((row) => Math.abs(row.powerError))),
      rows.filter((row) => row.linearError < 0 && row.powerError < 0).length];
    if (opticsPath) result.push(rows.filter((row) => row.outside !== 'None').length);
    return result;
  });
  writeTable(summary, 5, groupHeaders, groupRows, [2, 3, 4, 5]);
  note(summary, 11, 'Error = measured − predicted. Negative means predicted too high. MAE is the average absolute error.');

  note(summary, 14, 'Black layers compared within the same base fabric family', true);
  const pairRows = byGroup.slice(1, 3).map((rows, index) => {
    const baseGaps = rows.map((row) => row.baseGap).filter(Number.isFinite);
    const controlGaps = rows.map((row) => row.controlGap).filter(Number.isFinite);
    return [GROUPS[index + 1], baseGaps.length, mean(baseGaps), controlGaps.length, mean(controlGaps)];
  });
  writeTable(summary, 15, ['Fabric stack', 'Base pairs', 'Mean gap vs base', 'Stacks with controls',
    'Mean gap vs controls'], pairRows, [2, 4]);
  note(summary, 18, 'Gap = linear error for the black stack minus the comparison error.');
  note(summary, 19, 'Controls are non-black stacks with the same base family, layer count and backing.');
  note(summary, 20, 'Mixed stacks are shown as a group. Matched comparisons require an identified base fabric.');
  if (opticsPath) {
    note(summary, 22, 'Outside training range counts samples with at least one optical input beyond the values seen in their training fold.');
    note(summary, 23, 'Distance uses each optical input’s training standard deviation. Smaller values indicate a closer match.');
  }

  const headers = ['Sample', 'Fabric stack', 'Measured', 'Linear prediction', 'Power-sum prediction',
    'Linear error', 'Power-sum error', 'Matched base', 'Linear gap vs base', 'Non-black controls', 'Linear gap vs controls'];
  const widths = [232, 114, 82, 88, 92, 82, 92, 101, 90, 90, 100];
  if (opticsPath) {
    headers.push('Outside training range', 'Nearest training sample', 'Optical distance');
    widths.push(263, 228, 89);
  }
  formatSheet(details, widths);
  const rows = byGroup.flatMap((group) => [...group].sort((a, b) =>
    Math.abs(b.linearError) - Math.abs(a.linearError)));
  const detailRows = rows.map((row) => {
    const data = [row.sample, row.group, row.actual, row.linear, row.power, row.linearError, row.powerError,
      row.base ?? null, row.baseGap ?? null, row.controlCount ?? null, row.controlGap ?? null];
    if (opticsPath) data.push(row.outside, row.neighbor, row.distance);
    return data;
  });
  note(details, 1, `Predictions from ${basename(predictionsPath)} / Pred_${metric.replaceAll(' ', '_')}`);
  if (opticsPath) note(details, 2, `Optical measurements from ${basename(opticsPath)} / Per-Sample Values`);
  writeTable(details, 4, headers, detailRows, [2, 3, 4, 5, 6, 8, 10, ...(opticsPath ? [13] : [])]);
  details.freezePanes.freezeRows(4);
  return book;
}

async function loadPredictions(SpreadsheetFile, FileBlob, predictionsPath, metric) {
  const sheet = `Pred_${metric.replaceAll(' ', '_')}`;
  const rows = await readRows(SpreadsheetFile, FileBlob, predictionsPath, sheet,
    ['Sample', 'Family', 'Actual', 'Linear_grouped_cv', 'Powersum_grouped_cv']);
  const samples = rows.map(([name, familyName, actual, linear, power]) => {
    if (typeof name !== 'string' || !name.trim() || typeof familyName !== 'string' ||
        !familyName.trim() || ![actual, linear, power].every(Number.isFinite)) {
      throw new Error(`Incomplete family-held-out prediction for ${name ?? 'an unnamed sample'} in ${sheet}.`);
    }
    const sample = name.trim();
    const family = familyName.trim().toLowerCase();
    return { sample, family, actual, linear, power, linearError: actual - linear, powerError: actual - power,
      ...identifySample(sample, family) };
  });
  indexBySample(samples);
  if (new Set(samples.map((row) => row.family)).size < 2) {
    throw new Error(`${sheet} needs predictions from at least two fabric families.`);
  }
  addMatchedComparisons(samples);
  return samples;
}

function buildCombinedReport(Workbook, results, predictionsPath, opticsPath) {
  const book = Workbook.create();
  const summary = book.worksheets.add('Summary');
  const details = book.worksheets.add('Sample checks');
  formatSheet(summary, [156, 122, 70, 105, 105, 92, 92, 118]);
  summary.tabColor = '#243C51';
  note(summary, 2, 'Original fabric model validation', true);
  note(summary, 3, `${results[0][1].length} original samples per metric. Each prediction excludes its sample’s fabric family from fitting.`);
  const groupRows = results.flatMap(([metric, samples]) => GROUPS.map((group) => {
    const rows = samples.filter((sample) => sample.group === group);
    const linear = rows.map((row) => row.linearError);
    const power = rows.map((row) => row.powerError);
    return [metric, group, rows.length, mean(linear), mean(power), mean(linear.map(Math.abs)),
      mean(power.map(Math.abs)), rows.filter((row) => row.linearError < 0 && row.powerError < 0).length];
  }));
  writeTable(summary, 5, ['Image metric', 'Fabric stack', 'Samples', 'Linear mean error', 'Power-sum mean error',
    'Linear MAE', 'Power-sum MAE', 'Both predicted too high'], groupRows, [3, 4, 5, 6]);
  const notesStart = 6 + groupRows.length;
  note(summary, notesStart, 'Error = measured − predicted. Negative means predicted too high. MAE is the mean absolute error.');

  const comparisons = results.flatMap(([metric, samples]) => GROUPS.slice(1, 3).map((group) => {
    const rows = samples.filter((sample) => sample.group === group);
    const base = rows.map((row) => row.baseGap).filter(Number.isFinite);
    const controls = rows.map((row) => row.controlGap).filter(Number.isFinite);
    return [metric, group, base.length, mean(base), controls.length, mean(controls)];
  }));
  note(summary, notesStart + 2, 'Matched comparisons for the linear model', true);
  writeTable(summary, notesStart + 3, ['Image metric', 'Fabric stack', 'Base pairs', 'Mean gap vs base',
    'Stacks with controls', 'Mean gap vs controls'], comparisons, [3, 5]);
  note(summary, notesStart + 10, 'Gap = stack error minus comparison error. Controls share base family, layer count, and backing.');
  if (opticsPath) {
    const mixed = results[0][1].filter((row) => row.group === 'Mixed');
    if (mixed.length) {
      const outside = mixed.filter((row) => row.optics[2] < row.opacityRange[0] || row.optics[2] > row.opacityRange[1]);
      note(summary, notesStart + 11, `${outside.length} of ${mixed.length} mixed stacks were outside the opacity range of their training fold.`);
    }
  }

  const widths = [154, 235, 116, 83, 90, 90, 85, 85, 96, 92];
  if (opticsPath) widths.push(85, 90, 90, 205);
  formatSheet(details, widths);
  note(details, 1, `Prediction source · ${basename(predictionsPath)} · Pred_* sheets, grouped CV columns`);
  if (opticsPath) note(details, 2, `Measurements · ${basename(opticsPath)} · Per-Sample Values`);
  const headers = ['Image metric', 'Sample', 'Fabric stack', 'Measured', 'Linear prediction', 'Power-sum prediction',
    'Linear error', 'Power-sum error', 'Linear gap vs base', 'Linear gap vs controls'];
  if (opticsPath) headers.push('Opacity', 'Training opacity min', 'Training opacity max', 'Outside training range');
  const detailRows = results.flatMap(([metric, samples]) => [...samples]
    .sort((a, b) => Math.abs(b.linearError) - Math.abs(a.linearError))
    .map((row) => {
      const values = [metric, row.sample, row.group, row.actual, row.linear, row.power,
        row.linearError, row.powerError, row.baseGap ?? null, row.controlGap ?? null];
      if (opticsPath) values.push(row.optics[2], ...row.opacityRange, row.outside);
      return values;
    }));
  writeTable(details, 4, headers, detailRows, [3, 4, 5, 6, 7, 8, 9, ...(opticsPath ? [10, 11, 12] : [])]);
  details.freezePanes.freezeRows(4);
  return book;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { optics: { type: 'string' }, metric: { type: 'string', default: 'SSIM' }, preview: { type: 'string' } },
  });
  const [predictionsPath, outputPath = 'layer_errors.xlsx'] = positionals;
  const { metric, optics: opticsPath, preview } = values;
  if (!predictionsPath || positionals.length > 2 || ![...METRICS, 'All'].includes(metric)) {
    throw new Error('Usage: node layer_error_report.mjs multivariate_report.xlsx [layer_errors.xlsx] ' +
      '[--optics all_report.xlsx] [--metric "SSIM" | "Acutance" | "Michelson Contrast" | All]');
  }
  if ([predictionsPath, opticsPath].some((input) => input && resolve(input) === resolve(outputPath))) {
    throw new Error('Choose a different output path from the input workbooks.');
  }
  const dependency = createRequire(import.meta.url).resolve('@oai/artifact-tool', {
    paths: [dirname(fileURLToPath(import.meta.url)), dirname(process.execPath)],
  });
  const { Workbook, FileBlob, SpreadsheetFile } = await import(pathToFileURL(dependency).href);
  const metrics = metric === 'All' ? METRICS : [metric];
  const results = [];
  for (const name of metrics) {
    const samples = await loadPredictions(SpreadsheetFile, FileBlob, predictionsPath, name);
    if (opticsPath) {
      const target = name.replaceAll(' ', '_');
      const source = await readRows(SpreadsheetFile, FileBlob, opticsPath, 'Per-Sample Values',
        ['Sample', ...OPTICAL_COLUMNS, target]);
      const measurements = indexBySample(source.map(([sample, ...values]) => ({ sample, values })));
      for (const row of samples) {
        const measured = measurements.get(sampleKey(row.sample))?.values.at(-1);
        if (!Number.isFinite(measured) || Math.abs(measured - row.actual) > 1e-10) {
          throw new Error(`Saved and original ${name} measurements differ for ${row.sample}.`);
        }
      }
      addOpticalComparisons(samples, source.map((row) => row.slice(0, -1)));
    }
    results.push([name, samples]);
  }
  const book = metric === 'All'
    ? buildCombinedReport(Workbook, results, predictionsPath, opticsPath)
    : buildReport(Workbook, results[0][1], metric, predictionsPath, opticsPath);
  book.recalculate();
  if (preview) {
    await fs.mkdir(preview, { recursive: true });
    const ranges = metric === 'All'
      ? [['Summary', 'A1:H33'], ['Sample checks', opticsPath ? 'A1:N14' : 'A1:J14']]
      : [['Summary', opticsPath ? 'A1:H24' : 'A1:G24'], ['Samples', opticsPath ? 'A1:N14' : 'A1:K14']];
    for (const [sheetName, range] of ranges) {
      const image = await book.render({ sheetName, range, scale: 1.2, format: 'png' });
      await fs.writeFile(join(preview, `${sheetName}.png`), new Uint8Array(await image.arrayBuffer()));
    }
  }
  const outputDirectory = dirname(resolve(outputPath));
  await fs.mkdir(outputDirectory, { recursive: true });
  const scratch = await fs.mkdtemp(join(outputDirectory, '.layer-errors-'));
  try {
    const temporaryFile = join(scratch, 'report.xlsx');
    await (await SpreadsheetFile.exportXlsx(book)).save(temporaryFile);
    await fs.rename(temporaryFile, outputPath);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  console.log(`Wrote ${resolve(outputPath)} for ${metrics.join(', ')}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
