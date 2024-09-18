import React from "react";

// custom components
import { Toolbar } from "./Toolbar";
import DrawingGrid from "./DrawingGrid";
import PatternDisplay from "./PatternDisplay";
import SettingsForm from "./SettingsForm";
import DynamicModal from "./DynamicModal";
import DoubleCollapseToggle from "./DoubleCollapseToggle";

// package components
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { HotKeys } from "react-hotkeys";

// utility functions
import {
  isSquareLine,
  isSquareEdge,
  isSquareValid,
  isSquareEmptyAndValid
} from "../utils/square-utils";
import { initializeDots, fillRecursively } from "../utils/grid-utils";
import {
  deepClone,
  getIndexOfElementInParent,
  updateSettingsStyleVars,
  updateToolStyleVars,
  getParam
} from "../utils/general-utils";
import {
  updateLocallyStoredSettings,
  convertSettingsValueString,
  generateSaveObject,
  showLoadingError,
  convertBase64StringToGridData
} from "../utils/save-load-utils";
import {
  DEFAULT_TOOL,
  INIT_SETTINGS,
  ACTIVE_TOOL_DATA,
  PASSIVE_TOOL_DATA,
  SETTINGS_COMPRESSION_SPEC
} from "../constants";
import { fromJson, encode, decode } from "u-node";

// styles
import "./App.scss";
import "react-tabs/style/react-tabs.css";

export default class App extends React.Component {
  constructor(props) {
    super(props);

    let grid = [];
    for(let i = 0; i < INIT_SETTINGS.rows; i++) {
      const newRow = Array(INIT_SETTINGS.cols).fill(false);
      grid.push(newRow);
    }

    grid = initializeDots(grid);

    // read in any settings values that were stored locally
    const startingSettings = deepClone(INIT_SETTINGS);
    Object.keys(startingSettings).forEach(settingKey => {
      const storedSetting = localStorage.getItem(settingKey);
      if(storedSetting) {
        startingSettings[settingKey] = convertSettingsValueString(storedSetting);
      }
    });

    // history is kept separate from current grid since drawing a line requires several updates to
    // grid state in a row, but we only want one entry in the history
    // (if you only drew one pixel at a time, grid could be replaced with the most recent history entry)
    this.state = {
      activeTool: DEFAULT_TOOL,
      mouseHeld: false,
      grid: grid,
      history: [{
        grid: deepClone(grid),
        rows: INIT_SETTINGS.rows,
        cols: INIT_SETTINGS.cols
      }],
      currentHistoryIndex: 0,
      settings: startingSettings,
      activeModal: null,
      isLeftCollapsed: false,
      isRightCollapsed: false
    };

    // initialize default styles
    updateToolStyleVars(ACTIVE_TOOL_DATA[DEFAULT_TOOL]);
    updateSettingsStyleVars(this.state.settings);

    this.handleActiveToolbarClick = this.handleActiveToolbarClick.bind(this);
    this.handlePassiveToolbarClick = this.handlePassiveToolbarClick.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.updateHistoryIfNeeded = this.updateHistoryIfNeeded.bind(this);
    this.handleSquareInteract = this.handleSquareInteract.bind(this);
    this.handleDrawingAction = this.handleDrawingAction.bind(this);
    this.handleFillAction = this.handleFillAction.bind(this);
    this.handleLineAction = this.handleLineAction.bind(this);
    this.handleSettingsSubmit = this.handleSettingsSubmit.bind(this);
    this.updateRowsCount = this.updateRowsCount.bind(this);
    this.updateColsCount = this.updateColsCount.bind(this);
    this.handleModalCloseClick = this.handleModalCloseClick.bind(this);
    this.loadDataFromObject = this.loadDataFromObject.bind(this);
    this.toggleLeftCol = this.toggleLeftCol.bind(this);
    this.toggleRightCol = this.toggleRightCol.bind(this);
  }

  // confirm before leaving page
  handleBeforeUnload(e) {
    if(window.location.hostname !== "localhost") {
      e.preventDefault();
      e.returnValue = true;
    }
  }

  componentDidMount() {
    window.addEventListener("beforeunload", this.handleBeforeUnload);

    // if you hit a generated share link, parse and load in the pattern
    if(window.location.search.indexOf("share=") > -1) {
      const encoderV1 = fromJson(1, SETTINGS_COMPRESSION_SPEC);
      const decoded = decode([encoderV1], decodeURIComponent(getParam("share")));
      this.loadDataFromObject(decoded);
    }
  }

  componentWillUnmount() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
  }

  handleActiveToolbarClick(toolName) {
    this.setState({ activeTool: toolName });
    updateToolStyleVars(ACTIVE_TOOL_DATA[toolName]);
  }

  handlePassiveToolbarClick(toolName) {
    if(toolName === "New") {
      if(window.confirm("Are you sure you want to clear the grid? (You'll be able to undo.)")) {
        this.setState((state, props) => {
          return { grid: initializeDots(state.grid, true) };
        });
      }
    } else if(toolName === "Undo") {
      this.setState((state, props) => {
        const currentIndex = state.currentHistoryIndex;
        if(currentIndex === 0) return; // failsafe

        const prevHistory = state.history[currentIndex-1];
        const newSettings = deepClone(state.settings);
        newSettings.rows = prevHistory.rows;
        newSettings.cols = prevHistory.cols;
        return {
          grid: deepClone(prevHistory.grid),
          currentHistoryIndex: currentIndex - 1,
          settings: newSettings
        };
      });
    } else if(toolName === "Redo") {
      this.setState((state, props) => {
        const currentIndex = state.currentHistoryIndex;
        if(currentIndex === state.history.length-1) return; // failsafe

        const nextHistory = state.history[currentIndex+1];
        const newSettings = deepClone(state.settings);
        newSettings.rows = nextHistory.rows;
        newSettings.cols = nextHistory.cols;
        return {
          grid: deepClone(nextHistory.grid),
          currentHistoryIndex: currentIndex + 1,
          settings: newSettings
        };
      });
    } else if(toolName === "ShiftUp") {
      // shifts are lossy because behavior is inconsistent near the edges
      // if you have a "C" shape on the right edge, and shift right, the top and bottom bars will have to be lost
      // at least by losing everything that goes off the edge, it's intentional rather than looking buggy
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        newGrid.splice(1, 2);
        const dotsRow = Array(state.settings.cols).fill(false);
        for(let i = 1; i < dotsRow.length; i += 2) { dotsRow[i] = true; }
        newGrid.splice(newGrid.length-1, 0, Array(state.settings.cols).fill(false), dotsRow);
        return { grid: newGrid };
      });
    } else if(toolName === "ShiftDown") {
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        newGrid.splice(newGrid.length-3, 2);
        const dotsRow = Array(state.settings.cols).fill(false);
        for(let i = 1; i < dotsRow.length; i += 2) { dotsRow[i] = true; }
        newGrid.splice(1, 0, dotsRow, Array(state.settings.cols).fill(false));
        return { grid: newGrid };
      });
    } else if(toolName === "ShiftLeft") {
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        for(let i = 1; i < newGrid.length-1; i++) {
          const row = newGrid[i];
          row.splice(1, 2);
          row.splice(row.length-1, 0, false, i % 2 === 1);
        }
        return { grid: newGrid };
      });
    } else if(toolName === "ShiftRight") {
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        for(let i = 1; i < newGrid.length-1; i++) {
          const row = newGrid[i];
          row.splice(row.length-3, 2);
          row.splice(1, 0, i % 2 === 1, false);
        }
        return { grid: newGrid };
      });
    } else if(toolName === "Save") {
      const saveObj = generateSaveObject(this.state.grid, this.state.settings);
      const temp = document.createElement("a");
      const file = new Blob([JSON.stringify(saveObj)], {type: "text/plain"});
      temp.href = URL.createObjectURL(file);
      temp.download = "icg_save.icg";
      document.body.appendChild(temp); // Firefox compat
      temp.click();
      temp.remove();
    } else if(toolName === "Load") {
      if(!window.confirm("Are you sure you want to load a new pattern? Any unsaved work will be lost.")) return;

      // create a temporary file input to hold the uploaded save data
      const temp = document.createElement("input");
      temp.type = "file";
      temp.style.display = "none";
      temp.setAttribute("accept", ".icg");

      // delete any inputs from before, like if the user clicked cancel
      const oldInput = document.querySelector("input[type='file'][accept='.icg']");
      if(oldInput) oldInput.remove();

      // add the temp input to the page and set up behavior
      document.body.appendChild(temp);
      temp.addEventListener("change", e => {
        const file = e.target.files[0];
        if(!file) return; // failsafe
        const reader = new FileReader();
        reader.onload = e => {
          let dataEntries;
          try {
            dataEntries = JSON.parse(e.target.result);
          } catch(err) {
            showLoadingError("data isn't formatted correctly", e.target.result);
          }
          if(!dataEntries) return;
          if(!dataEntries.grid || !dataEntries.rows || !dataEntries.cols) return showLoadingError("missing grid data", dataEntries);

          this.loadDataFromObject(dataEntries);
        }

        // actually read the uploaded file
        reader.readAsText(file);
        temp.remove();
      });

      // prompt the user for a file to get the ball rolling
      temp.click();
    } else if(toolName === "Random") {
      if(!window.confirm("Are you sure you want to randomize all squares? (You'll be able to undo.)")) return;
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        for(let i = 1; i < newGrid.length-1; i++) {
          for(let j = 1; j < newGrid[i].length-1; j++) {
            if(isSquareLine(i, j)) {
              newGrid[i][j] = Math.random() >= 0.5;
            }
          }
        }
        return { grid: newGrid };
      });
    } else if(toolName === "Print") {
      window.print();
    } else if(toolName === "About") {
      this.setState({activeModal: "AboutModal"});
    } else if(toolName === "GenerateLink") {
      const encoderV1 = fromJson(1, SETTINGS_COMPRESSION_SPEC);
      const encoded = encodeURIComponent(encode(encoderV1, generateSaveObject(this.state.grid, this.state.settings)));
      this.setState({
        shareLink: `http://interlocking-crochet-generator.onrender.com/?share=${encoded}`,
        activeModal: "ShareModal"
      });
    } else if(toolName === "TurnOver") {
      this.setState((state, props) => {
        const newGrid = deepClone(state.grid);
        for(let i = 1; i < newGrid.length-1; i++) {
          for(let j = 1; j < newGrid[i].length-1; j++) {
            if(isSquareLine(i, j)) {
              newGrid[i][j] = !newGrid[i][j];
            }
          }
          newGrid[i].reverse();
        }
        return { grid: newGrid };
      });
    }
  }

  loadDataFromObject(dataEntries) {
    const {rows, cols} = dataEntries;
    const gridData = convertBase64StringToGridData(dataEntries.grid, rows, cols);

    // convert grid data into the form used by the app
    const grid = [];
    gridData.forEach(rowData => {
      const row = [];
      rowData.split("").forEach(squareData => {
        row.push(squareData === "1");
      });
      grid.push(row);
    });

    // ditch the loaded grid so only the settings remain
    delete dataEntries.grid;

    this.setState((state, props) => {
      // fold in loaded settings
      // don't ensure all settings are present, for backwards compat
      const newSettings = Object.assign(deepClone(state.settings), dataEntries);

      // done parsing, update the app!
      // (in theory we could just not wipe the history, but this makes more sense imo)
      updateSettingsStyleVars(dataEntries);
      return { grid: grid, settings: newSettings, currentHistoryIndex: 0, history: [{
        grid: deepClone(grid),
        rows: dataEntries.rows,
        cols: dataEntries.cols
      }]};
    });
  }

  handleMouseDown() {
    this.setState({ mouseHeld: true });
  }

  handleMouseUp() {
    this.setState({ mouseHeld: false });
    this.updateHistoryIfNeeded();
  }

  updateHistoryIfNeeded() {
    this.setState((state, props) => {
      const currentGrid = deepClone(state.grid);
      const history = deepClone(state.history).slice(0, state.currentHistoryIndex+1);
      const latestHistory = history[history.length-1].grid;

      if(JSON.stringify(currentGrid) !== JSON.stringify(latestHistory)) {
        history.push({
          grid: currentGrid,
          rows: state.settings.rows,
          cols: state.settings.cols
        });
        if(history.length > 20) history.shift();
        return {
          history: history,
          currentHistoryIndex: history.length-1
        };
      }
    });
  }

  handleDrawingAction(row, col, newVal) {
    this.setState((state, props) => {
      const newGrid = deepClone(state.grid);
      newGrid[row][col] = newVal;
      return { grid: newGrid};
    });
  }

  handleFillAction(row, col) {
    this.setState((state, props) => {
      // if they clicked an empty but invalid square, find the closest empty valid one (if one exists)
      if(!isSquareValid(row, col, state.grid) && !state.grid[row][col]) {
        if(isSquareEmptyAndValid(row, col-1, state.grid)) col = col-1;
        else if(isSquareEmptyAndValid(row-1, col, state.grid)) row = row-1;
        else if(isSquareEmptyAndValid(row, col+1, state.grid)) col = col+1;
        else if(isSquareEmptyAndValid(row+1, col, state.grid)) row = row+1;
        else return;
      }

      const newGrid = fillRecursively(row, col, deepClone(state.grid));
      return { grid: newGrid };
    });
  }

  // this is passed to DrawingGrid as a prop and called from there,
  // instead of from handleSquareInteract like the other active tools
  // since DrawingGrid is what knows about the positions of the line the user drew
  handleLineAction(lineStartX, lineStartY, lineEndX, lineEndY) {
    this.setState((state, props) => {
      // convert pixel amounts to grid coordinates
      const squareSize = this.state.settings.squareSize;
      let startCol = Math.floor(lineStartX / squareSize);
      let startRow = Math.floor(lineStartY / squareSize);
      let endCol = Math.floor(lineEndX / squareSize);
      let endRow = Math.floor(lineEndY / squareSize);

      // swap the positions if the user drew bottom to top or right to left
      // this way we only have to worry about looping in one direction
      if(startCol > endCol) {
        let temp = startCol;
        startCol = endCol;
        endCol = temp;
      }
      if(startRow > endRow) {
        let temp = startRow;
        startRow = endRow;
        endRow = temp;
      }

      const newGrid = deepClone(this.state.grid);
      if(startCol === endCol) { // vertical line
        for(let i = startRow; i <= endRow; i++) {
          if(isSquareLine(i, startCol) && !isSquareEdge(i, startCol, newGrid)) {
            newGrid[i][startCol] = true;
          }
        }
      } else if(startRow === endRow) { // horizontal line
        for(let i = startCol; i <= endCol; i++) {
          if(isSquareLine(startRow, i) && !isSquareEdge(startRow, i, newGrid)) {
            newGrid[startRow][i] = true;
          }
        }
      }

      return { grid: newGrid };
    });
  }

  // fill tool can click on invalid squares, but only sometimes (on clicks, not mousemoves)
  // allowFillValidityBypass lets DrawingGrid flag that condition
  handleSquareInteract(row, col, isValid, allowFillValidityBypass=false) {
    if(isValid || (this.state.activeTool === "Fill" && allowFillValidityBypass)) {
      const active = this.state.activeTool;
      if(active === "Pencil") {
        this.handleDrawingAction(row, col, true);
      } else if(active === "Eraser") {
        this.handleDrawingAction(row, col, false);
      } else if(active === "Fill") {
        this.handleFillAction(row, col);
      }
    }
  }

  // workaround for touchmove only firing from originating element,
  // meaning you basically can't draw by just dragging your finger
  // basically get the touched square indirectly instead of from the event's target
  handleTouchMove(e) {
    if(this.state.activeTool === "Line") return; // Line's touchmove stuff is handled in DrawingGrid

    // find the square the user is currently touching
    // the DOM element, not the component
    const touchLoc = e.changedTouches[0];
    const targetEl = document.elementFromPoint(touchLoc.clientX, touchLoc.clientY);
    if(!targetEl.classList.contains("DrawingGridSquare")) return;

    // figure out the details we would have if it were the component
    const col = getIndexOfElementInParent(targetEl);
    const row = getIndexOfElementInParent(targetEl.parentElement);
    const isValid = !isSquareEdge(row, col, this.state.grid) && isSquareLine(row, col);

    // hand off to the usual active tool handler
    this.handleSquareInteract(row, col, isValid);
  }

  handleSettingsSubmit(newValues) {
    // look for anything that has a handler function associated with it
    Object.keys(newValues).forEach(settingName => {
      const settingValue = newValues[settingName];
      const handlerFunc = {
        "rows": this.updateRowsCount,
        "cols": this.updateColsCount
      }[settingName];

      if(handlerFunc) {
        handlerFunc(settingValue);
      }
    });

    // update style variables as needed
    updateSettingsStyleVars(newValues);

    // update localStorage for anything stored there
    updateLocallyStoredSettings(newValues);

    // update everything in the state, then add a log in the history if the grid changed
    // lets you undo changing the grid size, in case you just shrank to 5 rows and lost all your work
    this.setState({ settings: newValues }, this.updateHistoryIfNeeded);
  }

  updateRowsCount(newCount) {
    this.setState((state, props) => {
      let newGrid = deepClone(state.grid);

      let delta = newCount - newGrid.length;
      if(delta > 0) {
        while(delta-- > 0) { newGrid.push(Array(newGrid[0].length).fill(false)); }
        newGrid = initializeDots(newGrid);
      } else if(delta < 0) {
        newGrid.length = newCount;
        newGrid[newGrid.length-1].fill(false); // empty out bottom edge
      }

      return { grid: newGrid };
    });
  }

  updateColsCount(newCount) {
    this.setState((state, props) => {
      let newGrid = deepClone(state.grid);

      const delta = newCount - newGrid[0].length;
      if(delta > 0) {
        for(let i = 0; i < newGrid.length; i++) {
          const row = newGrid[i];
          let rowDelta = delta;
          while(rowDelta-- > 0) { row.push(false); }
        }
        newGrid = initializeDots(newGrid);
      } else if(delta < 0) {
        for(let i = 0; i < newGrid.length; i++) {
          const row = newGrid[i];
          row.length = newCount;
          row[row.length-1] = false; // empty out right edge
        }
      }

      return { grid: newGrid };
    });
  }

  handleModalCloseClick() {
    this.setState({activeModal: null});
  }

  toggleLeftCol() {
    this.setState((state, props) => ({
      isLeftCollapsed: !state.isLeftCollapsed
    }));
  }

  toggleRightCol() {
    this.setState((state, props) => ({
      isRightCollapsed: !state.isRightCollapsed
    }));
  }

  render() {
    const hotkeysMap = {};
    Object.keys(ACTIVE_TOOL_DATA).forEach(activeToolKey => {
      hotkeysMap[activeToolKey] = ACTIVE_TOOL_DATA[activeToolKey].hotkey;
    });
    PASSIVE_TOOL_DATA.forEach(passiveToolSection => {
      Object.keys(passiveToolSection).forEach(passiveToolKey => {
        hotkeysMap[passiveToolKey] = passiveToolSection[passiveToolKey].hotkey;
      });
    });

    hotkeysMap.toggleLeft = "[";
    hotkeysMap.toggleRight = "]";

    const hotkeysHandlers = {};
    Object.keys(hotkeysMap).forEach(toolKey => {
      const isActive = !!ACTIVE_TOOL_DATA[toolKey];
      hotkeysHandlers[toolKey] = isActive ?
        () => this.handleActiveToolbarClick(toolKey) :
        () => {this.handlePassiveToolbarClick(toolKey); this.updateHistoryIfNeeded();}
    });

    // don't allow both cols to be collapsed at once
    hotkeysHandlers.toggleLeft = () => { if(!this.state.isRightCollapsed) this.toggleLeftCol(); };
    hotkeysHandlers.toggleRight = () => { if(!this.state.isLeftCollapsed) this.toggleRightCol(); };

    const modalProps = {
      modalName: this.state.activeModal,
      handleCloseClick: this.handleModalCloseClick
    };
    if(this.state.activeModal === "ShareModal") {
      modalProps.shareLink = this.state.shareLink;
    }

    return (
      <div
        className={`App  ${this.state.isLeftCollapsed ? "App--left-collapsed" : ""}  ${this.state.isRightCollapsed ? "App--right-collapsed" : ""}`}
        onMouseDown={this.handleMouseDown}
        onTouchStart={this.handleMouseDown}
        onMouseUp={this.handleMouseUp}
        onTouchEnd={this.handleMouseUp}
        onMouseLeave={this.handleMouseUp}
        onClick={this.updateHistoryIfNeeded}
        onTouchMove={this.handleTouchMove}
      >
        <HotKeys keyMap={hotkeysMap} handlers={hotkeysHandlers}>
          <Toolbar
            activeTool={this.state.activeTool}
            handleActiveClick={this.handleActiveToolbarClick}
            handlePassiveClick={this.handlePassiveToolbarClick}
            canUndo={this.state.currentHistoryIndex > 0}
            canRedo={this.state.currentHistoryIndex < this.state.history.length - 1}
          />
          <div className="App__main">
            <div className="App__col">
              <DrawingGrid
                grid={this.state.grid}
                showDetailedView={this.state.settings.showDetailedView}
                showGrid={this.state.settings.showGrid}
                showRowNums={this.state.settings.showRowNums}
                handleSquareInteract={this.handleSquareInteract}
                mouseHeld={this.state.mouseHeld}
                lineToolActive={this.state.activeTool === "Line"}
                handleLineAction={this.handleLineAction}
                truncateRowNums={this.state.settings.squareSize < 15}
              />
            </div>
            <DoubleCollapseToggle
              isLeftCollapsed={this.state.isLeftCollapsed}
              isRightCollapsed={this.state.isRightCollapsed}
              handleLeftBtnClick={this.toggleLeftCol}
              handleRightBtnClick={this.toggleRightCol}
            />
            <div className="App__col">
              <Tabs>
                <TabList>
                  <Tab>Pattern</Tab>
                  <Tab>Settings</Tab>
                </TabList>
                <TabPanel forceRender={true}>
                  {/* Forcing this to render enables us to force-show it when printing */}
                  <PatternDisplay
                    grid={this.state.grid}
                    leftHandedMode={this.state.settings.leftHandedMode}
                    showDetailedPattern={this.state.settings.showDetailedPattern}
                  />
                  </TabPanel>
                <TabPanel>
                  <SettingsForm
                    handleSubmit={this.handleSettingsSubmit}
                    settings={this.state.settings}
                  />
                </TabPanel>
              </Tabs>
            </div>
          </div>
        </HotKeys>
        {this.state.activeModal && <DynamicModal {...modalProps} />}
      </div>
    );
  }
}
