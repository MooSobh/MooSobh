# Astra prompt: Wadi Ghadir gravity processing and QC

You are an expert geophysicist in relative gravimetry, CG-6 field practice, GNSS/geodetic control, gravity reductions, terrain correction, and reproducible Python workflows. Process the supplied Wadi Ghadir, Eastern Desert, Egypt gravity survey as a scientific data product. The analysis must be metrologically careful, fully traceable, and suitable for a publication workflow. Do not manufacture missing metadata or label an incomplete reduction as a final Bouguer anomaly.

## Supplied files

- CG-6_0640_W_GHADIR_New_gravimeter(1).dat
- CG-6_0313_W_GHADER_old_gravimeter(1).dat
- GPS_All_Days(1).xlsx
- results.zip, containing daily GPS workbooks and KML files

The user reports collecting gravity with CG-6 and sometimes an instrument referred to as “Interacts.” Check the actual attachments. If there is no separate Interacts export, say so and do not infer that data. Do not assume numeric station IDs are global identifiers: they may repeat at different places. Link observations to GPS using date and coordinates, retain match distance and source, and flag ambiguous or unmatched observations.

## Required work

1. **Inventory and provenance**
   - Record every filename, byte count, instrument serial number, calibration metadata, firmware, date/time range, row count, and available fields.
   - Explain whether timestamps have a timezone and whether the instrument exports appear to contain on-board tide, level/tilt, temperature, and drift corrections.
   - Verify the exported corrected gravity numerically against raw gravity plus the individual correction columns. Never reapply a correction already included in CorrGrav.

2. **Observation-level QC**
   - Retain all original rows in a row-level table with explicit accept/reject flags and rejection reasons.
   - Inspect StdDev, StdErr, X/Y tilt, tilt correction, correction flags, measurement duration, repeated readings, jumps, base occupations, and GPS fields.
   - Plot the raw/corrected time series, correction terms, tilt distribution and rejected readings, instrument closure/control observations, and spatial coverage.
   - Use documented, explicit thresholds; show the consequences of each threshold and retain rejected observations in the audit outputs.

3. **Base control and instrument reconciliation**
   - Treat station 0 as the hotel opening/closing mark and station 100 as the repeatedly revisited field control.
   - Build date-specific occupation groups, show each station-100 time series and closure residuals, and use defensible time interpolation or a justified drift model within each day.
   - Do not use station 100 as an absolute gravity datum unless its gravity is supplied. Report relative gravity tied to 100 when absolute control is missing.
   - Diagnose any reset, datum jump, drift-model problem, scale issue, or inter-instrument inconsistency. Do not merge the two instruments solely by station number. Use actual spatial co-location and base loops to estimate offsets/scale only if the data support it.

4. **GPS / geodesy**
   - Parse the DMS coordinates and heights from the master and daily workbooks. Identify which daily GPS file corresponds to each observation date.
   - Match each occupation to the date-appropriate GPS point by coordinates and report the horizontal separation. Do not silently use user-entered instrument coordinates or a point ID match where the IDs are ambiguous.
   - Use the best supported height source; retain original heights, error estimates, matching distance, and match provenance.
   - State whether the elevations are ellipsoidal or orthometric, their reference frame/epoch, geoid model, antenna/rod height treatment, and uncertainty if known. If unknown, treat height-dependent products as provisional. Do not claim WGS84/EGM datum status without evidence.

5. **Gravity corrections and reductions**
   - Keep CG-6 on-board tide, tilt/level, temperature and drift corrections as already applied, unless a controlled independent recomputation is possible. Record local time interpretation and tide model limitations.
   - Apply an independently documented residual drift/tie adjustment from repeated base-100 visits; preserve the instrument output separately.
   - Compute free-air reduction using the correct sign and units; include the WGS84 normal-gravity latitude term for an anomaly product if latitude and base coordinates are reliable.
   - Compute simple Bouguer slab correction over a density sweep with 0.04193 * rho[g/cm3] * height[m] mGal and show the sign convention.
   - Apply terrain correction only from a suitable, resolution- and datum-documented DEM extending sufficiently far beyond the survey. Use Fatiando a Terra Harmonica or another validated open-source method, describe its DEM preprocessing and density assumptions, and compare/validate it if possible. If no DEM is supplied, do not invent terrain correction; label products simple Bouguer or provisional only.
   - State explicitly if absolute base gravity, normal-gravity reference, vertical datum, or DEM is missing. Do not call a base-relative height-corrected product an absolute Free-Air or Complete Bouguer anomaly.

6. **Nettleton density test**
   - Use the actual continuous topographic traverse(s), not an unsegmented map-wide regression. Identify the profile points, distance chainage, elevation range, quality screen, and correction terms.
   - Sweep a justified density interval and plot the resulting anomaly against topography and the correlation/residual metric versus density.
   - Repeat by independent profile where possible; report a density interval and uncertainty only when separate profiles support a stable minimum. If profiles disagree, are spatially unlinked, or lack terrain correction, explain why no single density is defensible. Give a clearly labelled provisional working value only if necessary, with sensitivity values, never as a measured rock density.

7. **Deliverables**
   - A comprehensive, well-structured technical report with a clear correction workflow, equations, QC results, limitations, density recommendation/status, and publication-quality uncluttered figures.
   - Python scripts that rerun from the supplied raw files on a normal computer; include environment requirements, command line examples, outputs, and clear comments.
   - Machine-readable station occupations, row-level QC, control-loop diagnostics, density sweeps, and plot files.
   - A concise decision list of the additional information required for final Complete Bouguer anomalies: known gravity at base 100 or an absolute tie, GNSS vertical datum/geoid and antenna setup, field time zone/clock settings, the separate Interacts data if used, and a suitable DEM.

## Reporting style

Write as prepared by **Dr. Mohamed Sobh, LIAG**. Use restrained scientific language, exact units, actual counts, and direct explanations. Distinguish observed values, computed values, and assumptions. No promotional phrasing, speculative interpretation, hidden exclusions, or AI-style filler. Figures should have readable labels, units, scales, legends, and captions. Provide both the raw instrument-applied correction columns and the later reduction terms so there is no double correction.

## Required output order

1. Start with a short executive finding and an evidence-based statement of what is and is not ready for interpretation.
2. Describe the complete processing chain in acquisition order.
3. Present QC and base control results.
4. Present reductions and Nettleton density evidence, including sensitivity and limitations.
5. Provide code, machine-readable outputs, and the metadata needed to complete the terrain-corrected absolute anomaly workflow.
