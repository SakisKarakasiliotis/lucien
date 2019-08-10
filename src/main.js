const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const process = require('process');
const openAboutWindow = require('about-window').default;

const appName = app.getName();

const initialFileState = {
  path: null,
  data: '',
  isDirty: false
};

const dialogFilters = [
  {
    name: 'Markdown Files',
    extensions: ['md', 'mkd', 'mdown', 'markdown']
  },
  { name: 'Text Files', extensions: ['txt', 'text'] },
  { name: 'All Files', extensions: ['*'] }
];

const saveChangesDialogButtons = {
  Discard: 0,
  Cancel: 1,
  Save: 2
};

let editorWindow = null;
let editorWindowMenu = null;
let fileState = { ...initialFileState };

// Clean up command-line arguments
const argv = [...process.argv];
argv.shift();
if (!app.isPackaged) argv.shift(); // Drop path in development

const updateWindowTitle = () => {
  let title = appName;
  const dirtyPrefix = fileState.isDirty ? '• ' : '';

  if (fileState.path) {
    title = `${dirtyPrefix}${path.basename(fileState.path)} - ${title}`;
  } else {
    title = `${dirtyPrefix}${title}`;
  }

  editorWindow.setTitle(title);
};

const updateWindowMenu = () => {
  editorWindowMenu.getMenuItemById('save').enabled = fileState.isDirty;
};

const setFileState = newState => {
  fileState = { ...fileState, ...newState };

  if (newState.path !== undefined || newState.isDirty !== undefined) {
    updateWindowTitle();
  }

  if (newState.isDirty !== undefined) {
    updateWindowMenu();
  }

  return fileState;
};

const showSaveChangesDialog = () => {
  if (!fileState.isDirty) return 0; // "Discard" non-existent changes

  return dialog.showMessageBoxSync(editorWindow, {
    type: 'question',
    buttons: Object.keys(saveChangesDialogButtons),
    defaultId: saveChangesDialogButtons.Save,
    cancelId: saveChangesDialogButtons.Cancel,
    title: 'Save changes?',
    message: 'Save changes before closing?'
  });
};

const openFile = filePath => {
  fs.readFile(filePath, (error, data) => {
    if (error) throw new Error(error);

    setFileState({
      path: filePath,
      data: data.toString(),
      isDirty: false
    });

    editorWindow.webContents.send('open-file', fileState.data);
  });
};

// Discards changes!
const openFileWithDialogUnsafe = () => {
  const [filePath] =
    dialog.showOpenDialogSync(editorWindow, {
      title: 'Open Markdown file',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: dialogFilters
    }) || [];

  if (!filePath) return; // Canceled

  openFile(filePath);
};

const openFileWithDialog = () => {
  switch (showSaveChangesDialog()) {
    case saveChangesDialogButtons.Discard:
      openFileWithDialogUnsafe();
      return;

    case saveChangesDialogButtons.Cancel:
      return;

    case saveChangesDialogButtons.Save:
      saveFileWithDialog()
        .then(openFileWithDialogUnsafe)
        .catch(error => {
          throw new Error(error);
        });
      return;
  }
};

const saveFileWithDialog = () => {
  return new Promise((resolve, reject) => {
    if (fileState.path) {
      fs.writeFile(fileState.path, fileState.data, error => {
        if (error) {
          reject(error);
        } else {
          setFileState({ isDirty: false });
          resolve();
        }
      });
      return;
    }

    const saveFilePath = dialog.showSaveDialogSync(editorWindow, {
      title: 'Save Markdown file',
      defaultPath: app.getPath('documents'),
      filters: dialogFilters
    });

    if (!saveFilePath) return; // Canceled

    fs.writeFile(saveFilePath, fileState.data, error => {
      if (error) {
        reject(error);
      } else {
        setFileState({
          path: saveFilePath,
          isDirty: false
        });
        resolve();
      }
    });
  });
};

// Discards changes!
const newFileUnsafe = () => {
  setFileState(initialFileState);

  editorWindow.webContents.send('new-file');
};

const newFile = () => {
  switch (showSaveChangesDialog()) {
    case saveChangesDialogButtons.Discard:
      newFileUnsafe();
      return;

    case saveChangesDialogButtons.Cancel:
      return;

    case saveChangesDialogButtons.Save:
      saveFileWithDialog()
        .then(newFileUnsafe)
        .catch(error => {
          throw new Error(error);
        });
      return;
  }
};

const editorWindowMenuTemplate = [
  {
    label: '&File',
    submenu: [
      {
        label: 'New',
        accelerator: 'CommandOrControl+N',
        click: newFile
      },
      {
        label: 'Open',
        accelerator: 'CommandOrControl+O',
        click: openFileWithDialog
      },
      {
        id: 'save',
        label: 'Save',
        accelerator: 'CommandOrControl+S',
        click: saveFileWithDialog
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: app.quit
      }
    ]
  },
  { label: '&Edit', role: 'editMenu' },
  { label: '&View', role: 'viewMenu' },
  {
    label: '&Help',
    submenu: [
      {
        label: 'Markdown spec',
        click: () => {
          shell.openExternal('https://github.github.com/gfm/');
        }
      },
      { type: 'separator' },
      {
        label: 'About',
        click: () => {
          openAboutWindow({
            icon_path: path.join(__dirname, 'icon.png'),
            copyright: `Copyright © ${new Date().getFullYear()} Angelos Orfanakos`,
            win_options: {
              parent: editorWindow,
              modal: true
            },
            adjust_window_size: true,
            use_version_info: false,
            show_close_button: 'Close'
          });
        }
      }
    ]
  }
];

const handleAppReady = () => {
  editorWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true
    }
  });

  editorWindowMenu = Menu.buildFromTemplate(editorWindowMenuTemplate);
  editorWindow.setMenu(editorWindowMenu);

  editorWindow
    .loadFile(path.join(__dirname, 'editor.html'))
    .then(() => {
      if (argv.length === 1) {
        openFile(argv[0]);
      }

      editorWindow.on('resize', () => {
        editorWindow.webContents.send(
          'window-resize',
          editorWindow.getBounds()
        );
      });
    })
    .catch(error => {
      throw new Error(error);
    });

  editorWindow.on('ready-to-show', editorWindow.show);
};

const handleAppBeforeQuit = event => {
  // Do not ask for confirmation to discard changes if the window has been
  // force-closed because we cannot reopen it again.
  // TODO: Ask for confirmation to save or discard changes before quitting
  // instead.
  if (!editorWindow.isVisible()) return;

  switch (showSaveChangesDialog()) {
    case saveChangesDialogButtons.Discard:
      return;

    case saveChangesDialogButtons.Cancel:
      event.preventDefault();
      return;

    case saveChangesDialogButtons.Save:
      event.preventDefault();

      saveFileWithDialog()
        .then(app.exit)
        .catch(error => {
          throw new Error(error);
        });

      return;
  }
};

app.on('ready', handleAppReady);

app.on('before-quit', handleAppBeforeQuit);

module.exports = {
  console,
  setFileState
};
