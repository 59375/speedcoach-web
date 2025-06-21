<script lang="ts">
/*──────────────────────── 依存 ───────────────────────*/
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { onMount } from 'svelte';
import Papa from 'papaparse';
import { DateTime } from 'luxon';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/*──────────── パスワード ───────────*/
if (browser && localStorage.getItem('sc_pw_ok') !== '1') goto('speedcoach_web/password');

/*───────────────── Utils ─────────────────*/
const timeStrToSec = (txt: any): number => {
	if (!txt) return NaN;
	const p = String(txt).replace(',', '.').split(':').map(Number);
	return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};
const paceStrToSec = (v: any) => (typeof v === 'number' ? v : timeStrToSec(v));
const sec2mmss = (s: number) =>
	isNaN(s)
		? '—'
		: `${Math.floor(s / 60)}:${Math.round(s % 60)
				.toString()
				.padStart(2, '0')}`;
const COLORS = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00'];

/*───────────────── State ─────────────────*/
let rows: any[] = [],
	tArray: number[] = [],
	yArray: number[] = [];
let rois: any[] = [],
	stats: any[] = [];
let prefix = 'roi_report';
let yRangeText = 'Y Range: —';
let Plotly: any = null;

/*───────── スナップ & デバウンス ─────────*/
const nearestT = (v: number) =>
	tArray.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
let snapTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnap() {
	if (snapTimer) clearTimeout(snapTimer);
	snapTimer = setTimeout(() => {
		for (const r of rois) {
			r.x0 = nearestT(r.x0);
			r.x1 = nearestT(r.x1);
		}
		updateShapes();
		updateStats();
	}, 150); // 150 ms 無操作でスナップ
}

/*──────────────── CSV Parse ───────────────*/
async function parseCsv(file: File) {
	Papa.parse(file, {
		header: false,
		skipEmptyLines: true,
		complete: ({ data }) => {
			const head = data.findIndex(
				(r) => String(r[0]).trim() === 'Interval' && r.includes('Elapsed Time')
			);
			if (head === -1 || data.length <= head + 2) {
				alert('ヘッダー検出失敗');
				return;
			}
			const csv = [
				data[head].join(','),
				...data.slice(head + 2).map((r) => r.join(',')),
			].join('\n');
			Papa.parse(csv, {
				header: true,
				dynamicTyping: true,
				skipEmptyLines: true,
				complete: ({ data }) => {
					const map = {
						elapsed: 'Elapsed Time',
						split: 'Split (GPS)',
						rate: 'Stroke Rate',
						dist: 'Distance (GPS)',
					};
					rows = data
						.filter((r) => r[map.elapsed] && r[map.split])
						.map((r) => ({
							t: timeStrToSec(r[map.elapsed]),
							pace: paceStrToSec(r[map.split]),
							rate: r[map.rate],
							dist: r[map.dist],
						}))
						.filter((r) => r.pace <= 480); // 4:00 を超える行は無視

					if (!rows.length) {
						alert('有効データなし');
						return;
					}

					tArray = rows.map((r) => r.t);
					yArray = rows.map((r) => r.pace);
					drawBase();
				},
			});
		},
	});
}

/*───────────── Plotly + ROI + Stats ─────────────*/
async function ensurePlotly() {
	if (!Plotly) Plotly = (await import('plotly.js-basic-dist')).default;
}

async function drawBase() {
	await ensurePlotly();

	/* 15 秒刻み目盛生成 */
	const maxSec = Math.ceil(Math.max(...yArray) / 15) * 15;
	const minSec = Math.floor(Math.min(...yArray) / 15) * 15;
	const tickVals: number[] = [];
	for (let s = maxSec; s >= minSec; s -= 15) tickVals.push(s);
	const tickText = tickVals.map(sec2mmss);

	yRangeText = `Y Range: ${sec2mmss(maxSec)} – ${sec2mmss(minSec)}`;

	const layout = {
		title: 'Split vs Time',
		plot_bgcolor: '#000',
		paper_bgcolor: '#000',
		xaxis: { title: 'Time (s)' },
		yaxis: {
			title: 'Split (mm:ss /500m)',
			autorange: 'reversed',
			tickmode: 'array',
			tickvals: tickVals,
			ticktext: tickText,
		},
		margin: { t: 20 },
		shapes: [],
	};
	const config = {
		responsive: true,
		editable: true,
		edits: { shapePosition: true, shapeSize: true },
	};
	Plotly.newPlot(
		'plot',
		[{ x: tArray, y: yArray, mode: 'lines', line: { color: '#fff' } }],
		layout,
		config
	);

	document.getElementById('plot')!.on('plotly_relayout', (ev) => {
		if (Object.keys(ev).some((k) => k.startsWith('shapes['))) {
			for (const k in ev) {
				const m = k.match(/^shapes\[(\d+)]\.(x0|x1)$/);
				if (m) {
					const i = +m[1];
					if (rois[i]) rois[i][m[2]] = ev[k];
				}
			}
			updateStats(); // ドラッグ中も速報
			scheduleSnap(); // 一定時間後にスナップ
		}
	});

	rois = [];
	addRoiInt(tArray[0], tArray[0] + 30);
	updateStats();
	updateShapes();
}

/*──────── ROI & Stats ─────────*/
function addRoiInt(x0: number, x1: number) {
	const c = COLORS[rois.length % COLORS.length];
	rois = [
		...rois,
		{ id: Date.now(), color: c, x0: nearestT(x0), x1: nearestT(x1) },
	];
	updateShapes();
}
function addRoi() {
	const mid = (tArray[0] + tArray.at(-1)!) / 2;
	addRoiInt(mid - 15, mid + 15);
	updateStats();
}
function removeRoi(i: number) {
	if (rois.length <= 1) return;
	rois = rois.filter((_, idx) => idx !== i);
	updateShapes();
	updateStats();
}
function updateShapes() {
	Plotly.relayout('plot', {
		shapes: rois.map((r) => ({
			type: 'rect',
			xref: 'x',
			yref: 'paper',
			x0: r.x0,
			x1: r.x1,
			y0: 0,
			y1: 1,
			fillcolor: r.color,
			opacity: 0.25,
			line: { width: 0 },
		})),
	});
}

function updateStats() {
	stats = rois.map((r, i) => {
		const seg = rows.filter((x) => x.t >= r.x0 && x.t <= r.x1);
		const avgRate =
			seg.reduce((s, v) => s + (v.rate ?? 0), 0) / Math.max(seg.length, 1);
		const avgPace =
			seg.reduce((s, v) => s + v.pace, 0) / Math.max(seg.length, 1);
		const dist =
			seg.length >= 2
				? (seg.at(-1)!.dist ?? NaN) - (seg[0].dist ?? NaN)
				: NaN;
		return {
			num: i + 1,
			avgRate: isNaN(avgRate) ? '—' : avgRate.toFixed(1),
			avgPaceOrSpd: sec2mmss(avgPace),
			dist: isNaN(dist) ? '—' : dist.toFixed(1),
			time: (r.x1 - r.x0).toFixed(1),
			color: r.color,
		};
	});
}

/*──────── Copy & PDF （不変） ─────────*/
async function ensurePlot() {
	await ensurePlotly();
}
async function copyPng() {
	await ensurePlot();
	const url = await Plotly.toImage('plot', { format: 'png' });
	const blob = await (await fetch(url)).blob();
	await navigator.clipboard.write([
		new ClipboardItem({ 'image/png': blob }),
	]);
	alert('PNG copied!');
}
async function copyTable() {
	const h = ['ROI #', 'Avg Rate', 'Avg Split', 'Dist (m)', 'Time (s)'];
	const txt = [
		h.join('\t'),
		...stats.map((s) =>
			[s.num, s.avgRate, s.avgPaceOrSpd, s.dist, s.time].join('\t')
		),
	].join('\r\n');
	await navigator.clipboard.writeText(txt);
	alert('TSV copied!');
}
async function exportPdf() {
	await ensurePlot();
	const p = await html2canvas(document.getElementById('plot')!);
	const t = await html2canvas(document.getElementById('statTable')!);
	const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
	const pw = pdf.internal.pageSize.getWidth(),
		ph = pdf.internal.pageSize.getHeight();
	pdf.addImage(p, 'PNG', 0, 0, pw, ph / 2);
	pdf.addImage(t, 'PNG', 0, ph / 2, pw, ph / 2);
	pdf.save(`${prefix}_${DateTime.now().toFormat('yyyyMMdd_HHmmss')}.pdf`);
}

/*──────── init ─────────*/
const onFile = (e: Event) => {
	const f = (e.target as HTMLInputElement).files?.[0];
	if (f) parseCsv(f);
};
onMount(ensurePlotly);
</script>

<style>
body {
	margin: 0;
}
.wrapper {
	background: #000;
	color: #fff;
	min-height: 100vh;
	padding: 1rem;
	font-family: sans-serif;
}
button,
input[type='file'] {
	background: #444;
	border: none;
	color: #fff;
	padding: 4px 8px;
	margin-right: 4px;
	font-size: 12px;
	cursor: pointer;
}
input[type='text'] {
	width: 80px;
}
table {
	width: 100%;
	border-collapse: collapse;
	font-size: 12px;
	color: #fff;
}
th,
td {
	border: 1px solid #555;
	padding: 4px 6px;
	text-align: center;
}
</style>

<div class="wrapper">
	<div
		style="margin-bottom: 8px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px"
	>
		<input type="file" accept=".csv" on:change={onFile} />
		<label>Prefix:<input type="text" bind:value={prefix} /></label>
		<button on:click={addRoi}>Add ROI</button>
		<button on:click={() => removeRoi(rois.length - 1)}>Remove ROI</button>
		<button on:click={exportPdf}>PDF</button>
		<button on:click={copyPng}>PNG</button>
		<button on:click={copyTable}>TSV</button>

		<span style="margin-left: auto; font-size: 12px; color: #ccc">{yRangeText}</span>
	</div>

	<div id="plot" style="width: 100%; height: 480px"></div>

	<table id="statTable">
		<thead>
			<tr>
				<th>ROI #</th>
				<th>Avg Rate</th>
				<th>Avg Split</th>
				<th>Dist (m)</th>
				<th>Time (s)</th>
			</tr>
		</thead>
		<tbody>
			{#each stats as s}
				<tr style="background: {s.color}55">
					<td>{s.num}</td>
					<td>{s.avgRate}</td>
					<td>{s.avgPaceOrSpd}</td>
					<td>{s.dist}</td>
					<td>{s.time}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
