# 🏗️ Архитектура и API договор (V2.3)

## 1. Трислојна структура
* **Апликација:** `index.html`, `css/style.css`, `default_machine.json` и 13 активни Vanilla JavaScript модули во `js/`, поврзани преку `window.CNCApp`. Нема build-чекор или надворешни runtime библиотеки.
* **Хардверски мост:** `bridge/bridge.cs`, `bridge/compile1.bat`, `bridge/fix.reg`; компајлираниот `Mach3Bridge.exe` се наоѓа до `index.html`.
* **SVG-примери и регресија:** `primer-avtomatski.csv`, `primer-racno.csv` и `test_star.svg` се локални тест-влезови. CSV-примерите се задржани како историски V2.2 референци.

## 2. Податочни модели (`CNCApp.State`)
* **Точка (`points[i]`):** `{ active, x, y, speed, lower, valveStart, time, valveStop, raise, dispenser, group1, group2, clearance? }`
* **Диспензер (`machine.dispensers[i]`):** `{ id, name, color, lowerCmd, raiseCmd, offsetX, offsetY }`
* **Машина (`machine`):** `{ name, systemDelayLower, systemDelayRaise, mCommandLatency, valveOpenCmd, valveCloseCmd, homeCommand, parkCommand, timeUnit, decimalSeparator, minX, maxX, minY, maxY, moveClickSpeed, dispensers[] }`
* **Таб (`Tabs.tabs[i]`):** `{ id, projectName, isDirty, isRunningOnMachine, points, header, footer, svgData, svgImage, svgObjectUrl, showSvg, showClearanceRings, isAddMode, selectedIndices[], activePointIndex, lastSelectedRowIndex, shadedDispensers[], history[], historyIndex, viewState }`

## 3. Јавни модули и методи (`window.CNCApp`)
* **`State` (`js/state.js`):** `getDefaultDispensers()`, `isLegacyDispenserOffset(d1)`, `migrateLegacyDispensers(d, preserve)`, `escapeHtml(str)`, `getDefaultMachineConfig()`, `loadDefaultMachineProfile(cb)`, `normalizeMachineConfig()`, `createPoint(x, y, refPt)`, `isActiveTabReadOnly()`, `setProjectName(name)`, `markDirty(dirty)`, `updateProjectUI()`, `snapshot()`, `undo()`, `redo()`
* **`Tabs` (`js/tabs.js`):** `createTabRecord(opts)`, `getActiveTab()`, `getTabById(id)`, `syncFromState()`, `applyTabToState(tab, opts)`, `hydrateSvgForTab(tab)`, `initWithDefaultDemo()`, `restoreFromStorage(tabs, activeId)`, `switchTab(id)`, `newTab(switchNow)`, `closeTab(id, forceDiscard)`, `resetActiveTabForLoadedData(opts)`, `hasAnyUnsavedChanges()`, `exportTabsForStorage(stripInactiveSvgs)`, `renderTabBar()`
* **`Storage` (`js/storage.js`):** `saveToBridgeTemp(payload, immediate)`, `syncOrRecoverBridgeTemp(cb)`, `saveAutoSave(immediateBridge)`, `migrateMachineSettings(m)`, `migrateFooter(str)`, `loadAutoSave()`
* **`Parser` (`js/parser.js`):** `parseTxt(text)`, `parseLegacyCsv(text)`, `parseProjectCsv(text)`, `exportProjectCsv()`, `loadSvgContent(svgText, opts)`
* **`MachineDriver` (`js/machine-driver.js`):** `register(drv)`, `get(id)`, `list()`, `setActive(id)`, `getActive()`
* **`SimulatorDriver` (`js/driver-simulator.js`) & `Mach3BridgeDriver` (`js/driver-mach3.js`):**
  Унифициран интерфејс: `connect(cb)`, `disconnect(cb)`, `getSnapshot()`, `getStatus(cb)`, `isGcodeLoaded(hash)`, `loadGcode(gcode, meta, cb)`, `runLoaded(cb)`, `loadAndRun(gcode, meta, cb)`, `pause(cb)`, `resume(cb)`, `stop(cb)`, `reset(cb)`, `jog(axis, stepMm, cb)`, `zeroAxis(axis, cb)`, `moveTo(x, y, feed, cb)`, `runQuickCommand(cmd, cb)`, `sendCommand(cmd, cb)`, `raiseAllDispensers(disps, cb)` (+ `Mach3BridgeDriver.syncConfig(cb)`, `baseUrl`)
* **`Machine` (`js/machine-driver.js`):** `init()`, `isConnected()`, `isBusy()`, `isTabSwitchLocked()`, `isTabLocked(id)`, `isActiveTabReadOnly()`, `getLimits()`, `validateMachineCoords(x, y)`, `checkActivePointsBounds(startIdx)`, `isDispenserLowered(id)`, `hasLoweredOrValveOpen()`, `connect()`, `disconnect()`, `switchDriver(id)`, `startActiveTabJob()`, `startFromSelectedPoint()`, `togglePause()`, `stopJob()`, `resetMachine()`, `jogAxis(axis, dir, opts)`, `zeroAxis(axis)`, `getSelectedPanelDispenser()`, `teachPointFromDro()`, `setMoveToClickMode(on)`, `moveDispenserToModelPoint(mx, my)`, `runQuickCommand(cmd)`, `toggleDispenser(id)`, `raiseAllDispensers()`, `toggleValve()`, `pulseValve100ms()`, `sendMdiCommand(cmd)`, `setKeyboardJogMode(on)`, `handleKeyboardArrow(e)`, `toggleCollapse()`, `applyPanelLayout()`, `refreshDispenserSelect()`, `renderDispenserButtons()`, `refreshUI()`
* **`Canvas` (`js/canvas.js`):** `init()`, `resize()`, `resetView()`, `worldToScreen(wx, wy)`, `screenToWorld(sx, sy)`, `finishBoxSelect()`, `findHitPoint(wx, wy)`, `render()`, `drawReachableBoundary()`, `drawGrid(stepMm)`
* **`Table` (`js/table.js`):** `render()`, `updateSelectionUI()`, `moveRow(from, to)`, `moveSelectedUp()`, `moveSelectedDown()`, `updateField(idx, field, val)`, `updateRow(idx)`, `scrollToRow(idx)`, `insertNewPointAt(x, y)`, `updateGroupDropdown()`, `enforceActiveSafety(idx, val)`, `enforceDispenserSafety()`, `showContextMenu(x, y, field)`, `closeContextMenu()`, `bulkSetCheckbox(field, val)`, `bulkToggleCheckbox(field)`, `selectIntermediatePoints()`, `promptBulkSpeed()`, `scaleSpeed(factor)`
* **`GCode` (`js/gcode.js`):** `telemetry`, `formatCoord(val)`, `generate(startIndex)`, `updateCycleTime()`
* **`SvgGenerator` (`js/svg-generator.js`):** `openModal(svgText)`, `closeModal()`, `parseDimensionToMm(str, dpi)`, `parseAndAnalyze(svgText)`, `normalizeColorToHex(c)`, `findClosestDispenser(hex)`, `convertNodeToPathStrings(node)`, `updateModalUI()`, `computeEDT(grid, w, h)`, `samplePocketMedialAxis(paths, opts)`, `generatePoints(opts)`, `applyToProject(replace)`. Во рамки на исто поле, точките се подредуваат во внатрешни потези; `group1` останува идентификатор на полето, не на потегот.
* **`Calibration` (`js/calibration.js`):** `init()`, `open()`, `closeUI()`, `cancel()`, `closeBeforeTabChange()`, `renderDispenserButtons()`, `selectDispenser(id)`, `updateUI()`, `onPointsMoved(dx, dy)`, `nudge(dx, dy)`, `revertToInitialPoints()`, `applyCurrentDispenser(stay)`, `applyAndNext()`
* **`App` (`js/app.js`):** `CNCApp.updateSvgToggleUI()`, `CNCApp.App` (`renderCanvasDispenserFilters()`, `refreshToolbarStates()`, `isTabSwitchLocked()`, `saveCurrentProject()`, `openUnsavedModal(title, html, onProceed)`, `deleteDispenser(idx)`)

## 4. Клучни DOM ID-ја
* **Табови и проект:** `#tabsList`, `#btnNewTab`, `#projectNameDisplay`, `#projectSaveStatus`, `#btnSaveProjectCsv`, `#cycleTimeDisplay`, `#cycleSubDisplay`
* **Табела и масовно:** `#tablePanel`, `#tableBody`, `#selectedCount`, `#batchColor`, `#batchSpeed`, `#batchTime`, `#batchOffsetX`, `#batchOffsetY`, `#batchGroup1`, `#batchGroup2`, `#selByColor`, `#selByGroup`
* **Canvas:** `#mainCanvas`, `#canvasWrapper`, `#coordDisplay`, `#dispenserFilterButtons`, `#btnToggleAddMode`, `#btnToggleMoveToClick`, `#btnToggleSvg`, `#btnToggleClearance`
* **Машина:** `#machinePanel`, `#machineDriverSelect`, `#btnMachineConnect`, `#machineStatusBadge`, `#machineSafetyBanner`, `#machineMdiInput`, `#droX`, `#droY`, `#droIOState`, `#machineActiveDispenser`, `#machineDispButtons`, `#btnMachineValve`, `#btnMachineReset`, `#chkStrictTabLock`
* **Модали:** `#calibrationSidePanel`, `#settingsModal` (`#dispensersTableBody`), `#svgGeneratorModal`, `#unsavedModal`, `#csvOffsetsModal`, `#gcodePreviewModal` (`#gcodePreviewText`)

## 5. HTTP REST API на `Mach3Bridge.exe` (`http://127.0.0.1:8765`)
* `GET /status` | `GET/POST /temp/autosave` | `POST /config`
* `POST /load_gcode` | `POST /run_loaded` | `POST /load_and_run`
* `POST /pause` | `POST /resume` | `POST /stop` | `POST /reset`
* `POST /jog` | `POST /zero` | `POST /mdi` | статички фајлови (`/` -> `index.html`)