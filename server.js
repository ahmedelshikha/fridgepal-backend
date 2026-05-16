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

function cleanJson(text = '') {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

function imageToBase64(path) {
  const imageBuffer = fs.readFileSync(path);
  return imageBuffer.toString('base64');
}

function normalizeBarcode(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function getBarcodeVariants(barcode) {
  const clean = normalizeBarcode(barcode);
  const variants = new Set();

  if (!clean) return [];

  variants.add(clean);

  if (clean.length === 13 && clean.startsWith('0')) {
    variants.add(clean.slice(1));
  }

  if (clean.length === 12) {
    variants.add(`0${clean}`);
  }

  if (clean.length < 13) {
    variants.add(clean.padStart(13, '0'));
  }

  return Array.from(variants).filter(Boolean);
}

function inferBarcodeCategoryAndLocation(product = {}) {
  const name = String(
    product.product_name ||
      product.product_name_en ||
      product.generic_name ||
      ''
  ).toLowerCase();

  const categoryText = [
    product.categories,
    product.categories_tags?.join(' '),
    product.labels,
    product.ingredients_text,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const text = `${name} ${categoryText}`;

  if (
    text.includes('milk') ||
    text.includes('cheese') ||
    text.includes('yogurt') ||
    text.includes('butter') ||
    text.includes('cream') ||
    text.includes('dairy')
  ) {
    return { category: 'Dairy', location: 'Fridge' };
  }

  if (
    text.includes('chicken') ||
    text.includes('beef') ||
    text.includes('turkey') ||
    text.includes('pork') ||
    text.includes('fish') ||
    text.includes('salmon') ||
    text.includes('seafood') ||
    text.includes('meat')
  ) {
    return { category: 'Protein', location: 'Fridge' };
  }

  if (text.includes('frozen') || text.includes('ice cream')) {
    return { category: 'Frozen', location: 'Freezer' };
  }

  if (
    text.includes('fruit') ||
    text.includes('vegetable') ||
    text.includes('produce') ||
    text.includes('salad')
  ) {
    return { category: 'Produce', location: 'Fridge' };
  }

  if (
    text.includes('bread') ||
    text.includes('rice') ||
    text.includes('pasta') ||
    text.includes('cereal') ||
    text.includes('oats') ||
    text.includes('grain')
  ) {
    return { category: 'Grains', location: 'Pantry' };
  }

  if (
    text.includes('snack') ||
    text.includes('chips') ||
    text.includes('cookie') ||
    text.includes('cracker') ||
    text.includes('sauce') ||
    text.includes('beverage') ||
    text.includes('drink') ||
    text.includes('juice') ||
    text.includes('soda')
  ) {
    return { category: 'Pantry', location: 'Pantry' };
  }

  return { category: 'Other', location: 'Pantry' };
}

function getNutritionFacts(product = {}) {
  const n = product.nutriments || {};

  return {
    calories: n['energy-kcal_100g'] ?? null,
    energyKj: n['energy-kj_100g'] ?? null,
    sugar: n.sugars_100g ?? null,
    sodium: n.sodium_100g ?? null,
    salt: n.salt_100g ?? null,
    fat: n.fat_100g ?? null,
    saturatedFat: n['saturated-fat_100g'] ?? null,
    carbs: n.carbohydrates_100g ?? null,
    protein: n.proteins_100g ?? null,
    fiber: n.fiber_100g ?? null,
  };
}

async function lookupOpenFoodFacts(barcode) {
  const variants = getBarcodeVariants(barcode);

  for (const code of variants) {
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json`
      );

      if (!response.ok) continue;

      const data = await response.json();

      if (data.status !== 1 || !data.product) continue;

      const product = data.product;

      const name =
        product.product_name ||
        product.product_name_en ||
        product.generic_name ||
        '';

      if (!name) continue;

      const { category, location } = inferBarcodeCategoryAndLocation(product);

      return {
        found: true,
        source: 'openfoodfacts',
        matchedBarcode: code,
        item: {
          name,
          quantity: product.quantity || product.serving_size || '1 item',
          category,
          location,
          expirationDate: '',
          barcode: code,
          brand: product.brands || '',
          imageUrl: product.image_front_url || '',
          nutriScore: product.nutriscore_grade || '',
          novaGroup: product.nova_group || '',
          ingredients: product.ingredients_text || '',
          additivesCount: product.additives_n || 0,
          allergens: product.allergens || '',
          labels: product.labels || '',
          nutrition: getNutritionFacts(product),
        },
      };
    } catch (error) {
      console.log(`Open Food Facts lookup error for ${code}:`, error.message);
    }
  }

  return null;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'FridgePal backend is running',
    routes: [
      '/kitchen-chat',
      '/generate-meal-plan',
      '/stores-for-state',
      '/lookup-barcode',
      '/search-recipes',
      '/analyze-fridge',
      '/analyze-receipt',
    ],
  });
});

app.get('/search-recipes', async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const apiKey = process.env.SPOONACULAR_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'Missing Spoonacular API key',
      });
    }

    const url =
      `https://api.spoonacular.com/recipes/complexSearch` +
      `?query=${encodeURIComponent(query)}` +
      `&number=10` +
      `&addRecipeInformation=true` +
      `&fillIngredients=true` +
      `&instructionsRequired=true` +
      `&apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();

      console.log('Spoonacular error:', text);

      return res.status(response.status).json({
        error: 'Spoonacular request failed',
        details: text,
      });
    }

    const data = await response.json();

    const recipes = (data.results || []).map((recipe) => ({
      id: recipe.id,
      name: recipe.title,
      image: recipe.image,
      prepTime: recipe.readyInMinutes
        ? `${recipe.readyInMinutes} mins`
        : '',
      servings: recipe.servings || 1,
      source: 'Spoonacular',
      sourceUrl: recipe.sourceUrl || '',
      cuisine: recipe.cuisines?.[0] || recipe.dishTypes?.[0] || 'Recipe',
      ingredients: (recipe.extendedIngredients || []).map(
        (ingredient) => ingredient.original
      ),
      instructions:
        recipe.analyzedInstructions?.[0]?.steps?.map((step) => step.step) ||
        [],
      summary: recipe.summary || '',
    }));

    res.json({ recipes });
  } catch (error) {
    console.error('Search recipes error:', error);

    res.status(500).json({
      error: 'Recipe search failed',
      details: error.message,
    });
  }
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
app.post('/generate-recipes', async (req, res) => {
  try {
    const { inventory = [] } = req.body;

    if (!Array.isArray(inventory) || inventory.length === 0) {
      return res.status(400).json({ error: 'Inventory is required' });
    }

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content:
            'You are FridgePal recipe AI. Return only valid JSON. No markdown.',
        },
        {
          role: 'user',
          content: `
Create 3 realistic recipes using this inventory:
${JSON.stringify(inventory, null, 2)}

Prioritize ingredients that expire soon.

Return ONLY valid JSON:
{
  "recipes": [
    {
      "id": "ai-recipe-1",
      "name": "Recipe name",
      "description": "Short description",
      "prepTime": "20 mins",
      "servings": 2,
      "cuisine": "AI Generated",
      "ingredients": ["ingredient 1"],
      "missingIngredients": ["missing item 1"],
      "instructions": ["step 1", "step 2"]
    }
  ]
}
`,
        },
      ],
    });

    const parsed = JSON.parse(cleanJson(response.output_text));

    res.json({
      recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
    });
  } catch (error) {
    console.error('Generate recipes error:', error);

    res.status(500).json({
      error: 'AI recipe generation failed',
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
    const barcode = normalizeBarcode(req.body?.barcode);

    if (!barcode) {
      return res.status(400).json({ error: 'Barcode is required' });
    }

    const openFoodFactsResult = await lookupOpenFoodFacts(barcode);

    if (openFoodFactsResult) {
      return res.json(openFoodFactsResult);
    }

    return res.json({
      found: false,
      source: 'openfoodfacts',
      searchedBarcodes: getBarcodeVariants(barcode),
      item: {
        name: '',
        quantity: '1 item',
        category: 'Other',
        location: 'Pantry',
        expirationDate: '',
        barcode,
        brand: '',
        imageUrl: '',
        nutriScore: '',
        novaGroup: '',
        ingredients: '',
        additivesCount: 0,
        allergens: '',
        labels: '',
        nutrition: {
          calories: null,
          energyKj: null,
          sugar: null,
          sodium: null,
          salt: null,
          fat: null,
          saturatedFat: null,
          carbs: null,
          protein: null,
          fiber: null,
        },
      },
    });
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