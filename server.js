import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'FridgePal backend is running',
  });
});

app.post('/kitchen-chat', async (req, res) => {
  try {
    const { message, inventory = [], shoppingList = [] } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'Missing OPENAI_API_KEY',
      });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required',
      });
    }

    const inventorySummary = Array.isArray(inventory)
      ? inventory.map((item) => ({
          name: item.name || item.food || item.title || 'Unknown item',
          quantity: item.quantity || item.amount || '',
          expiryDate:
            item.expiryDate ||
            item.expirationDate ||
            item.expiresAt ||
            item.expiry ||
            '',
          category: item.category || '',
        }))
      : [];

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

You help users:
- cook meals from their current inventory
- reduce food waste
- identify what expires soon
- suggest grocery list items
- give simple nutrition tips

Always be concise, practical, and friendly.

If the user asks what they can cook:
- suggest 2 to 4 realistic meals
- mention which inventory items each meal uses
- mention any missing ingredients

If the user asks what expires soon:
- sort by closest expiry date when possible
- explain what should be used first

If inventory is empty:
- say you do not see fridge items yet
- still offer general meal ideas

If the user asks about shopping list ideas:
- suggest practical grocery items
- do not claim anything was saved unless an action was returned
`,
        },
        {
          role: 'user',
          content: `
User message:
${message}

Current inventory:
${JSON.stringify(inventorySummary, null, 2)}

Current shopping list:
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

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'Missing OPENAI_API_KEY',
      });
    }

    if (!Array.isArray(inventory) || inventory.length === 0) {
      return res.status(400).json({
        error: 'Inventory is required',
      });
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
Create a ${days}-day meal plan using this grocery inventory:
${JSON.stringify(inventory, null, 2)}

Goal:
${goal}

Return ONLY valid JSON using this exact shape:
{
  "summary": "short helpful summary",
  "shoppingList": ["missing grocery 1", "missing grocery 2"],
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

Rules:
- Prioritize food expiring soon.
- Use inventory item names exactly when possible.
- Missing items should be simple grocery names.
- Keep meals realistic and easy.
- Include breakfast, lunch, and dinner for every day.
`,
        },
      ],
    });

    const cleanedText = response.output_text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const mealPlan = JSON.parse(cleanedText);

    res.json({
      mealPlan,
    });
  } catch (error) {
    console.error('Meal plan error:', error);

    res.status(500).json({
      error: 'Meal plan generation failed',
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`FridgePal backend running on http://localhost:${PORT}`);
});
