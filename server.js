import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import multer from 'multer';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

function imageToBase64(path) {
  const imageBuffer = fs.readFileSync(path);
  return imageBuffer.toString('base64');
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'FridgePal backend is running',
  });
});

app.post('/kitchen-chat', async (req, res) => {
  try {
    const { message, inventory = [], shoppingList = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const lowerMessage = message.toLowerCase();
    const addMatch = lowerMessage.match(/add (.+?) to (my )?shopping list/i);

    if (addMatch && addMatch[1]) {
      const itemName = addMatch[1].trim();

      return res.json({
        reply: `✅ Added "${itemName}" to your shopping list.`,
        action: {
          type: 'ADD_TO_SHOPPING_LIST',
          item: itemName,
        },
      });
    }

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content: `
You are FridgePal AI, a smart kitchen assistant.
Help users cook meals, reduce food waste, identify expiring food, and suggest groceries.
Be concise, practical, and friendly.
`,
        },
        {
          role: 'user',
          content: `
User message:
${message}

Inventory:
${JSON.stringify(inventory, null, 2)}

Shopping list:
${JSON.stringify(shoppingList, null, 2)}
`,
        },
      ],
    });

    res.json({
      reply: response.output_text || 'I could not generate a response.',
    });
  } catch (error) {
    console.error('Kitchen chat error:', error);

    res.status(500).json({
      error: 'Kitchen chat failed',
      details: error.message,
    });
  }
});

app.post('/generate-meal-plan', async (req, res) => {
  try {
    const { inventory = [], days = 3, goal = 'Use Expiring Food' } = req.body;

    if (!Array.isArray(inventory) || inventory.length === 0) {
      return res.status(400).json({ error: 'Inventory is required' });
    }

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You are FridgePal meal planning AI. Return only valid JSON. No markdown.',
        },
        {
          role: 'user',
          content: `
Create a ${days}-day meal plan using this inventory:
${JSON.stringify(inventory, null, 2)}

Goal:
${goal}

Return ONLY valid JSON:
{
  "summary": "short helpful summary",
  "shoppingList": ["missing grocery 1"],
  "days": [
    {
      "day": 1,
      "breakfast": {
        "name": "Meal name",
        "prepTime": "15 mins",
        "uses": ["inventory item"],
        "missing": ["missing item"],
        "instructions": ["step 1", "step 2"]
      },
      "lunch": {
        "name": "Meal name",
        "prepTime": "20 mins",
        "uses": ["inventory item"],
        "missing": ["missing item"],
        "instructions": ["step 1", "step 2"]
      },
      "dinner": {
        "name": "Meal name",
        "prepTime": "30 mins",
        "uses": ["inventory item"],
        "missing": ["missing item"],
        "instructions": ["step 1", "step 2"]
      }
    }
  ]
}
`,
        },
      ],
    });

    const mealPlan = JSON.parse(cleanJson(response.output_text));

    res.json({ mealPlan });
  } catch (error) {
    console.error('Meal plan error:', error);

    res.status(500).json({
      error: 'Meal plan generation failed',
      details: error.message,
    });
  }
});

app.post('/stores-for-state', async (req, res) => {
  try {
    const { state } = req.body;

    if (!state || typeof state !== 'string') {
      return res.status(400).json({ error: 'State is required' });
    }

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You are a grocery retail assistant. Return only valid JSON. No markdown.',
        },
        {
          role: 'user',
          content: `
Return common grocery stores available in ${state}, USA.

Return ONLY valid JSON:
{
  "stores": ["Walmart", "Costco", "Instacart"]
}
`,
        },
      ],
    });

    const parsed = JSON.parse(cleanJson(response.output_text));

    res.json({
      stores: Array.isArray(parsed.stores)
        ? parsed.stores
        : ['Walmart', 'Costco', 'Instacart'],
    });
  } catch (error) {
    console.error('Stores for state error:', error);

    res.status(500).json({
      error: 'Could not detect stores',
      details: error.message,
    });
  }
});

app.post('/lookup-barcode', async (req, res) => {
  try {
    const { barcode } = req.body;

    if (!barcode) {
      return res.status(400).json({ error: 'Barcode is required' });
    }

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You identify grocery products from barcodes when possible. Return only valid JSON.',
        },
        {
          role: 'user',
          content: `
Barcode:
${barcode}

Return ONLY valid JSON:
{
  "found": true,
  "item": {
    "name": "product name or blank if unknown",
    "quantity": "1 item",
    "expirationDate": ""
  }
}

If you are not sure, return:
{
  "found": false,
  "item": {
    "name": "",
    "quantity": "1 item",
    "expirationDate": ""
  }
}
`,
        },
      ],
    });

    const parsed = JSON.parse(cleanJson(response.output_text));

    res.json(parsed);
  } catch (error) {
    console.error('Barcode lookup error:', error);

    res.status(500).json({
      error: 'Barcode lookup failed',
      details: error.message,
    });
  }
});

app.post('/analyze-fridge', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const base64Image = imageToBase64(req.file.path);

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You analyze grocery/fridge photos and return only valid JSON. No markdown.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `
Detect visible grocery/food items in this image.

Return ONLY valid JSON:
{
  "items": [
    {
      "name": "food name",
      "quantity": "1 item",
      "expirationDate": ""
    }
  ]
}

Rules:
- Only include clear grocery or food items.
- Use simple names.
- Estimate quantity if visible.
- If no food is visible, return {"items":[]}.
`,
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${base64Image}`,
            },
          ],
        },
      ],
    });

    fs.unlinkSync(req.file.path);

    const parsed = JSON.parse(cleanJson(response.output_text));

    res.json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch (error) {
    console.error('Analyze fridge error:', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Fridge image analysis failed',
      details: error.message,
    });
  }
});

app.post('/analyze-receipt', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Receipt image is required' });
    }

    const base64Image = imageToBase64(req.file.path);

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You read grocery receipts and return only valid JSON. No markdown.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `
Read this grocery receipt.

Return ONLY valid JSON:
{
  "items": [
    {
      "name": "grocery item",
      "quantity": "1 item",
      "category": "Produce",
      "location": "Fridge",
      "expirationDate": ""
    }
  ]
}

Rules:
- Only include grocery/food items.
- Ignore taxes, totals, payment lines, discounts, and non-food items.
- Use simple readable names.
- Choose category from: Dairy, Protein, Produce, Grains, Pantry, Frozen, Other.
- Choose location from: Fridge, Freezer, Pantry.
- If no groceries are found, return {"items":[]}.
`,
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${base64Image}`,
            },
          ],
        },
      ],
    });

    fs.unlinkSync(req.file.path);

    const parsed = JSON.parse(cleanJson(response.output_text));

    res.json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch (error) {
    console.error('Analyze receipt error:', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Receipt analysis failed',
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`FridgePal backend running on http://localhost:${PORT}`);
});