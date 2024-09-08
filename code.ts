figma.showUI(__html__, { width: 600, height: 290 });

// Handle messages received from the HTML page
figma.ui.onmessage = async (msg: { type: string }) => {
  if (msg.type === 'select-frame') {
    await handleSelectFrameMessage();
  } else if (msg.type === 'create-palette') {
    await handleCreatePaletteMessage();
  } else {
    await handleAssignColorMessage(msg);
  }
};

// Function to handle the 'select-frame' message
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function handleSelectFrameMessage() {
  const selectedFrames = figma.currentPage.selection.filter(node => node.type === 'FRAME');

  if (selectedFrames.length === 0) {
    figma.notify("Please select a frame on the canvas.");
    return;
  }

  // Assuming you want to work with the first selected frame
  const selectedFrame = selectedFrames[0] as FrameNode;

  figma.notify(`Frame "${selectedFrame.name}" selected.`);
  console.log("Frame Selected: " + selectedFrame.name);

  // Store the selected frame globally if needed
  figma.root.setPluginData('selectedFrameId', selectedFrame.id);
}


// Function to handle the 'create-palette' message
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function handleCreatePaletteMessage() {
  const frameId = figma.root.getPluginData('selectedFrameId');
  if (!frameId) {
    figma.notify("No frame selected. Please select a frame first.");
    return;
  }

  try {
    // Await the result of getNodeByIdAsync and check if it's a FrameNode
    const node = await figma.getNodeByIdAsync(frameId);
    if (!node || node.type !== 'FRAME') {
      figma.notify("Selected frame is no longer available or is not a frame.");
      return;
    }

    const frame = node as FrameNode;

    // Export the frame as JPEG
    const jpegBytes = await exportFrameAsJPEG(frame);

    // Send the JPEG image to the API
    const colorPalette = await sendToAPI(jpegBytes);

    // Create rectangles with the colors from the palette on the canvas
    createColorPaletteOnCanvas(colorPalette);

  } catch (error) {
    console.error(error);
    figma.notify("An error occurred while exporting the image or sending it to the API.");
  }
}

// Function to export a frame as JPEG
async function exportFrameAsJPEG(frame: FrameNode): Promise<Uint8Array> {
  const imageData = await frame.exportAsync({ format: 'JPG' });
  return imageData;
}

// Function to send the JPEG image data to the API and return the color palette
async function sendToAPI(imageData: Uint8Array): Promise<string[]> {
  const response = await fetch('http://localhost:5000/process_image', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg' // or 'image/jpeg' if it's a JPEG
    },
    body: imageData
  });

  if (!response.ok) {
    throw new Error(`Failed to send image to API: ${response.statusText}`);
  }

  const result = await response.json();
  figma.notify("Image exported and palette received successfully.");  

  return result.color_palette; // Assuming the API returns an array of color hex codes
} 

// Function to create rectangles on the canvas with the colors from the palette
function createColorPaletteOnCanvas(colorPalette: string[]) {
  const nodes: SceneNode[] = [];

  colorPalette.forEach((color, index) => {
    const rect = figma.createRectangle();
    rect.x = 100 + (index * 110); // Position rectangles with some spacing
    rect.y = 100;
    rect.resize(100, 100);
    rect.fills = [{ type: 'SOLID', color: hexToRgb(color), boundVariables: {} }];

    figma.currentPage.appendChild(rect);
    nodes.push(rect);
  });

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
}

// Helper function to convert hex color to RGB
function hexToRgb(hex: string): RGB {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r: r / 255, g: g / 255, b: b / 255 };
}


// Function to handle the 'assign-color' message
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function handleAssignColorMessage(msg: { type: string }) {
  if (msg.type === 'assign-color') {

    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.notify("Please select a frame on the canvas.");
      return;
    } 
    if (selection[0].type != "FRAME") {
      figma.notify("Selected item is not a single frame.");
      return;
    } 

    const frame = selection[0]; // Assuming the user selected a single frame
    figma.notify(`Frame "${frame.name}" selected.`);

    const allLayers = frame.findAll(layer => layer.name !== 'main').reverse(); // Find all layers within the frame

    // Convert allLayers to the desired format
    const layers = allLayers.map(layer => ({ name: layer.name }));
    layers.reverse();
    console.log(layers);

    // Export the frame as JPEG
    const jpegBytes = await exportFrameAsJPEG(frame);
    // Send the JPEG image data to the API

    const colorPalette = await sendToAPI(jpegBytes);


    // console.log("******************************************");
    // console.log(colorPalette);
    // console.log("******************************************");


    assignColorsToLayers(layers,colorPalette);

    figma.notify('Assign Color action triggered');
  }
}

function hexToRgbValues(hex: string): [number, number, number] {
  const bigint = parseInt(hex.slice(1), 16); // Convert hex to decimal
  const r = (bigint >> 16) & 255; // Extract red component
  const g = (bigint >> 8) & 255;  // Extract green component
  const b = bigint & 255;         // Extract blue component
  return [r, g, b];               // Return RGB values as an array
}
async function assignColorsToLayers(layers: { name: string }[], colorPalette: string[]) {

  const palette = colorPalette.map(hexToRgbValues);
  try {
    const response = await fetch('http://localhost:5000/assign_colors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        layers: layers,
        palette: palette
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const assignment = await response.json();
    console.log('Color Assignment:', assignment);

    const updatedAssignment = processAssignment(assignment);
    console.log('Updated Assignment:', updatedAssignment);

  } catch (error) {
    console.error('Error:', error);
  }
}


///// recoloring
////////////////////////////////////////////////////////////////////

// Apply the dominant color logic to each layer's assigned color
function processAssignment(assignment: Record<string, [number, number, number]>): Record<string, [number, number, number]> {
  const updatedAssignment: Record<string, [number, number, number]> = {};

  for (const layer in assignment) {
      if (assignment.hasOwnProperty(layer)) {
          const layerColor = assignment[layer];
          const updatedColor = applyDominantColor(layerColor, layerColor); // Adjusting each layer based on its own assigned color
          updatedAssignment[layer] = updatedColor;
      }
  }

  return updatedAssignment;
}

import * as colorConvert from 'color-convert';
// Apply dominant color to a layer
function applyDominantColor(layerColor: [number, number, number], targetColor: [number, number, number], scaleFactor = 1.0): [number, number, number] {
    
  const targetLab = getLabValuesFromColor(targetColor);
  const [targetA, targetB] = targetLab;

  const [l, a, b] = colorConvert.rgb.lab(layerColor[0], layerColor[1], layerColor[2]);

  // Calculate the adjustments
  const adjustmentA = (targetA - a) * scaleFactor;
  const adjustmentB = (targetB - b) * scaleFactor;

  // Adjusted values
  const newA = Math.min(255, Math.max(0, a + adjustmentA));
  const newB = Math.min(255, Math.max(0, b + adjustmentB));

  // Convert back to RGB
  const [newR, newG, newBFinal] = colorConvert.lab.rgb([l, newA, newB]);

  return [newR, newG, newBFinal];
}


function getLabValuesFromColor(color: [number, number, number]): [number, number] {
  const [r, g, b] = color;
  const [l, a, bLab] = colorConvert.rgb.lab(r, g, b);
  return [a, bLab];
}
