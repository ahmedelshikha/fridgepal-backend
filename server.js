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

const INGREDIENT_FLAGS = {
  'red 40': {
    level: 'high',
    reason: 'Artificial food dye',
  },
  'yellow 5': {
    level: 'high',
    reason: 'Artificial coloring additive',
  },
  'yellow 6': {
    level: 'high',
    reason: 'Artificial coloring additive',
  },
  'sodium nitrite': {
    level: 'high',
    reason: 'Processed meat preservative',
  },
  aspartame: {
    level: 'moderate',
    reason: 'Artificial sweetener',
  },
  sucralose: {
    level: 'moderate',
    reason: 'Artificial sweetener',
  },
  acesulfame: {
    level: 'moderate',
    reason: 'Artificial sweetener',
  },
  carrageenan: {
    level: 'moderate',
    reason: 'Texture stabilizer',
  },
  'soybean oil': {
    level: 'moderate',
    reason: 'Highly processed seed oil',
  },
  'canola oil': {
    level: 'moderate',
    reason: 'Highly refined seed oil',
  },
  'corn oil': {
    level: 'moderate',
    reason: 'Processed vegetable oil',
  },
  'cottonseed oil': {
    level: 'moderate',
    reason: 'Refined industrial oil',
  },
  pistachios: {
    level: 'positive',
    reason: 'Whole food ingredient',
  },
  almonds: {
    level: 'positive',
    reason: 'Nutrient-dense whole food',
  },
  oats: {
    level: 'positive',
    reason: 'High fiber whole grain',
  },
  peanuts: {
    level: 'positive',
    reason: 'Protein-rich whole food',
  },
  eggs: {
    level: 'positive',
    reason: 'High-quality protein source',
  },
  salmon: {
    level: 'positive',
    reason: 'Rich in omega-3 fats',
  },
};

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

function extractServingGrams(servingSize = '') {
  if (!servingSize) return null;

  const match = String(servingSize)
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)\s*g/);

  if (!match) return null;

  return Number(match[1]);
}

function convertNutritionPerServing(nutrition = {}, grams = null) {
  if (!grams || grams <= 0) return null;

  const multiplier = grams / 100;

  const convert = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Number((number * multiplier).toFixed(2));
  };

  return {
    calories: convert(nutrition.calories),
    energyKj: convert(nutrition.energyKj),
    sugar: convert(nutrition.sugar),
    sodium: convert(nutrition.sodium),
    salt: convert(nutrition.salt),
    fat: convert(nutrition.fat),
    saturatedFat: convert(nutrition.saturatedFat),
    carbs: convert(nutrition.carbs),
    protein: convert(nutrition.protein),
    fiber: convert(nutrition.fiber),
  };
}

function extractOffIngredients(ingredientsArray) {
  if (!Array.isArray(ingredientsArray)) return '';

  return ingredientsArray
    .map((ingredient) => ingredient.text || ingredient.id || '')
    .filter(Boolean)
    .join(', ');
}

function normalizeIngredients(spoonProduct = {}, ingredientsText = '') {
  if (Array.isArray(spoonProduct.ingredients) && spoonProduct.ingredients.length > 0) {
    return spoonProduct.ingredients
      .map((ingredient) => ({
        name: ingredient.name || ingredient.original || '',
        original: ingredient.original || ingredient.name || '',
        amount: ingredient.amount || null,
        unit: ingredient.unit || '',
      }))
      .filter((ingredient) => ingredient.name);
  }

  return String(ingredientsText || '')
    .split(',')
    .map((name) => ({
      name: name.trim(),
      original: name.trim(),
      amount: null,
      unit: '',
    }))
    .filter((ingredient) => ingredient.name);
}
function analyzeIngredients(ingredients = []) {
  const findings = [];

  for (const ingredient of ingredients) {
    const normalized = String(ingredient.name || ingredient)
      .toLowerCase()
      .trim();

    const exactMatch = INGREDIENT_FLAGS[normalized];

    if (exactMatch) {
      findings.push({
        ingredient: ingredient.name || ingredient,
        level: exactMatch.level,
        reason: exactMatch.reason,
      });
      continue;
    }

    const partialKey = Object.keys(INGREDIENT_FLAGS).find((key) =>
      normalized.includes(key)
    );

    if (partialKey) {
      findings.push({
        ingredient: ingredient.name || ingredient,
        level: INGREDIENT_FLAGS[partialKey].level,
        reason: INGREDIENT_FLAGS[partialKey].reason,
      });
    }
  }

  return findings;
}

function calculateFridgePalHealthScore({
  nutriScore,
  novaGroup,
  additivesCount,
  nutrition,
  spoonProduct,
  ingredients,
  ingredientAnalysis = [],
}) {
  let score =
    nutriScore === 'a'
      ? 92
      : nutriScore === 'b'
      ? 80
      : nutriScore === 'c'
      ? 62
      : nutriScore === 'd'
      ? 42
      : nutriScore === 'e'
      ? 22
      : 70;

  if (Number(novaGroup) === 4) score -= 14;
  if (Number(novaGroup) === 3) score -= 7;

  if (Number(additivesCount) >= 5) score -= 12;
  else if (Number(additivesCount) >= 3) score -= 8;
  else if (Number(additivesCount) >= 1) score -= 3;

  if (Number(nutrition?.sugar) >= 22) score -= 12;
  else if (Number(nutrition?.sugar) >= 10) score -= 7;

  if (Number(nutrition?.saturatedFat) >= 5) score -= 7;
  if (Number(nutrition?.salt) >= 1.5) score -= 7;

  if (Number(nutrition?.fiber) >= 5) score += 6;
  if (Number(nutrition?.protein) >= 8) score += 5;

  const badges = spoonProduct?.badges || [];

  if (badges.includes('organic')) score += 3;
  if (badges.includes('whole_grain')) score += 3;
  if (badges.includes('no_added_sugar')) score += 4;
  if (badges.includes('no_additives')) score += 4;
  if (badges.includes('no_preservatives')) score += 3;

  const lowerIngredients = String(ingredients || '').toLowerCase();

  const concernWords = [
    'high fructose corn syrup',
    'corn syrup',
    'hydrogenated oil',
    'partially hydrogenated',
    'artificial flavor',
    'artificial colour',
    'artificial color',
    'msg',
    'sodium nitrite',
  ];

  concernWords.forEach((word) => {
    if (lowerIngredients.includes(word)) score -= 5;
  });

  ingredientAnalysis.forEach((finding) => {
    if (finding.level === 'high') score -= 8;
    if (finding.level === 'moderate') score -= 4;
    if (finding.level === 'positive') score += 3;
  });

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildHealthInsights({
  nutriScore,
  novaGroup,
  additivesCount,
  nutrition,
  spoonProduct,
  ingredients,
  ingredientAnalysis = [],
  servingSize,
  nutritionPerServing,
}) {
  const insights = [];

  if (nutriScore === 'a' || nutriScore === 'b') {
    insights.push({
      type: 'positive',
      title: 'Better nutrition profile',
      detail: 'This product has a stronger nutrition profile.',
    });
  }

  if (nutriScore === 'd' || nutriScore === 'e') {
    insights.push({
      type: 'warning',
      title: 'Lower nutrition quality',
      detail: 'This product has a weaker nutrition profile.',
    });
  }

  if (Number(novaGroup) === 4) {
    insights.push({
      type: 'warning',
      title: 'Ultra-processed food',
      detail: 'This product is classified as ultra-processed (NOVA 4).',
    });
  }

  if (Number(novaGroup) === 3) {
    insights.push({
      type: 'warning',
      title: 'Processed food',
      detail: 'This product is classified as processed (NOVA 3).',
    });
  }

  if (Number(additivesCount) >= 3) {
    insights.push({
      type: 'warning',
      title: 'Multiple additives detected',
      detail: `Contains ${additivesCount} additives.`,
    });
  }

  if (Number(additivesCount) === 0) {
    insights.push({
      type: 'positive',
      title: 'No additives detected',
      detail: 'No additive markers were found in this product data.',
    });
  }

  if (Number(nutrition?.sugar) >= 22) {
    insights.push({
      type: 'warning',
      title: 'Very high sugar per 100g',
      detail: `Contains ${nutrition.sugar}g sugar per 100g.`,
    });
  } else if (Number(nutrition?.sugar) >= 10) {
    insights.push({
      type: 'warning',
      title: 'High sugar per 100g',
      detail: `Contains ${nutrition.sugar}g sugar per 100g.`,
    });
  }

  if (nutritionPerServing && Number(nutritionPerServing.sugar) >= 10) {
    insights.push({
      type: 'warning',
      title: 'High sugar per serving',
      detail: `Contains ${nutritionPerServing.sugar}g sugar per serving${
        servingSize ? ` (${servingSize})` : ''
      }.`,
    });
  }

  if (Number(nutrition?.fiber) >= 5) {
    insights.push({
      type: 'positive',
      title: 'Good fiber content',
      detail: `Contains ${nutrition.fiber}g fiber per 100g.`,
    });
  }

  if (nutritionPerServing && Number(nutritionPerServing.fiber) >= 2) {
    insights.push({
      type: 'positive',
      title: 'Good fiber per serving',
      detail: `Contains ${nutritionPerServing.fiber}g fiber per serving${
        servingSize ? ` (${servingSize})` : ''
      }.`,
    });
  }

  if (Number(nutrition?.protein) >= 8) {
    insights.push({
      type: 'positive',
      title: 'Good protein content',
      detail: `Contains ${nutrition.protein}g protein per 100g.`,
    });
  }

  if (nutritionPerServing && Number(nutritionPerServing.protein) >= 5) {
    insights.push({
      type: 'positive',
      title: 'Good protein per serving',
      detail: `Contains ${nutritionPerServing.protein}g protein per serving${
        servingSize ? ` (${servingSize})` : ''
      }.`,
    });
  }

  ingredientAnalysis.forEach((finding) => {
    insights.push({
      type:
        finding.level === 'positive'
          ? 'positive'
          : finding.level === 'high'
          ? 'warning'
          : 'badge',
      title: finding.ingredient,
      detail: finding.reason,
    });
  });

  const badges = spoonProduct?.importantBadges || spoonProduct?.badges || [];

  badges.slice(0, 4).forEach((badge) => {
    insights.push({
      type: 'badge',
      title: String(badge).replaceAll('_', ' '),
      detail: 'Detected by product analysis.',
    });
  });

  if (!ingredients) {
    insights.push({
      type: 'missing',
      title: 'Ingredients missing',
      detail: 'Ingredient label data was not available for this barcode.',
    });
  }

  return insights;
}

async function lookupOpenFoodFacts(barcode) {
  const variants = getBarcodeVariants(barcode);

  const fields = [
    'product_name',
    'product_name_en',
    'generic_name',
    'quantity',
    'serving_size',
    'brands',
    'image_front_url',
    'image_url',
    'ingredients_text',
    'ingredients_text_en',
    'ingredients',
    'ingredients_tags',
    'additives_tags',
    'additives_n',
    'allergens',
    'labels',
    'categories',
    'categories_tags',
    'nutriscore_grade',
    'nova_group',
    'nutriments',
  ].join(',');

  for (const code of variants) {
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`,
        {
          headers: {
            'User-Agent':
              process.env.OFF_USER_AGENT ||
              'FridgePal/1.0 (contact@fridgepal.app)',
          },
        }
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

      const ingredients =
        product.ingredients_text_en ||
        product.ingredients_text ||
        extractOffIngredients(product.ingredients) ||
        '';

      const additives = Array.isArray(product.additives_tags)
        ? product.additives_tags.map((tag) => String(tag).replace('en:', ''))
        : [];

      const nutrition = getNutritionFacts(product);

      const servingSize = product.serving_size || '';
      const servingGrams = extractServingGrams(servingSize || product.quantity || '');
      const nutritionPerServing = convertNutritionPerServing(
        nutrition,
        servingGrams
      );

      const normalizedIngredients = normalizeIngredients({}, ingredients);
      const ingredientAnalysis = analyzeIngredients(normalizedIngredients);

      return {
        found: true,
        source: 'openfoodfacts',
        matchedBarcode: code,
        raw: product,
        item: {
          name,
          quantity: product.quantity || product.serving_size || '1 item',
          category,
          location,
          expirationDate: '',
          barcode: code,
          brand: product.brands || '',
          imageUrl: product.image_front_url || product.image_url || '',
          nutriScore: product.nutriscore_grade || '',
          novaGroup: product.nova_group || '',

          ingredients,
          normalizedIngredients,
          ingredientAnalysis,

          additives,
          additivesCount:
            typeof product.additives_n === 'number'
              ? product.additives_n
              : additives.length,

          allergens: product.allergens || '',
          labels: product.labels || '',

          nutrition,
          servingSize,
          servingGrams,
          nutritionPerServing,

          healthInsights: buildHealthInsights({
            nutriScore: String(product.nutriscore_grade || '').toLowerCase(),
            novaGroup: product.nova_group || '',
            additivesCount:
              typeof product.additives_n === 'number'
                ? product.additives_n
                : additives.length,
            nutrition,
            spoonProduct: {},
            ingredients,
            ingredientAnalysis,
            servingSize,
            nutritionPerServing,
          }),
        },
      };
    } catch (error) {
      console.log(`Open Food Facts lookup error for ${code}:`, error.message);
    }
  }

  return null;
}
async function lookupSpoonacularProduct(barcode) {
  const apiKey = process.env.SPOONACULAR_API_KEY;

  if (!apiKey) {
    console.log('Missing SPOONACULAR_API_KEY');
    return null;
  }

  const variants = getBarcodeVariants(barcode);

  for (const code of variants) {
    try {
      const response = await fetch(
        `https://api.spoonacular.com/food/products/upc/${code}?apiKey=${apiKey}`
      );

      if (!response.ok) {
        const text = await response.text();
        console.log(`Spoonacular UPC lookup failed for ${code}:`, text);
        continue;
      }

      const product = await response.json();

      if (!product || product.status === 'failure') continue;

      return {
        matchedBarcode: code,
        product,
      };
    } catch (error) {
      console.log(`Spoonacular UPC error for ${code}:`, error.message);
    }
  }

  return null;
}

function buildMergedBarcodeResult({
  barcode,
  openFoodFactsResult,
  spoonacularResult,
}) {
  const offItem = openFoodFactsResult?.item || {};
  const spoonProduct = spoonacularResult?.product || {};

  const ingredients =
    offItem.ingredients ||
    spoonProduct.ingredientList ||
    '';

  const normalizedIngredients =
    offItem.normalizedIngredients?.length
      ? offItem.normalizedIngredients
      : normalizeIngredients(spoonProduct, ingredients);

  const ingredientAnalysis =
    offItem.ingredientAnalysis?.length
      ? offItem.ingredientAnalysis
      : analyzeIngredients(normalizedIngredients);

  const nutrition = {
    calories:
      offItem.nutrition?.calories ??
      spoonProduct.nutrition?.calories ??
      null,
    energyKj:
      offItem.nutrition?.energyKj ??
      null,
    sugar:
      offItem.nutrition?.sugar ??
      spoonProduct.nutrition?.sugar ??
      null,
    sodium:
      offItem.nutrition?.sodium ??
      spoonProduct.nutrition?.sodium ??
      null,
    salt:
      offItem.nutrition?.salt ??
      null,
    fat:
      offItem.nutrition?.fat ??
      spoonProduct.nutrition?.fat ??
      null,
    saturatedFat:
      offItem.nutrition?.saturatedFat ??
      spoonProduct.nutrition?.saturatedFat ??
      null,
    carbs:
      offItem.nutrition?.carbs ??
      spoonProduct.nutrition?.carbs ??
      null,
    protein:
      offItem.nutrition?.protein ??
      spoonProduct.nutrition?.protein ??
      null,
    fiber:
      offItem.nutrition?.fiber ??
      spoonProduct.nutrition?.fiber ??
      null,
  };

  const servingSize =
    offItem.servingSize ||
    spoonProduct.servingSize ||
    '';

  const servingGrams =
    offItem.servingGrams ||
    extractServingGrams(servingSize);

  const nutritionPerServing =
    offItem.nutritionPerServing ||
    convertNutritionPerServing(nutrition, servingGrams);

  const nutriScore = String(offItem.nutriScore || '').toLowerCase();
  const novaGroup = offItem.novaGroup || '';

  const additivesCount =
    offItem.additivesCount !== undefined && offItem.additivesCount !== null
      ? offItem.additivesCount
      : 0;

  const healthScore = calculateFridgePalHealthScore({
    nutriScore,
    novaGroup,
    additivesCount,
    nutrition,
    spoonProduct,
    ingredients,
    ingredientAnalysis,
  });

  const healthInsights = buildHealthInsights({
    nutriScore,
    novaGroup,
    additivesCount,
    nutrition,
    spoonProduct,
    ingredients,
    ingredientAnalysis,
    servingSize,
    nutritionPerServing,
  });

  return {
    found: true,
    source: {
      openFoodFacts: Boolean(openFoodFactsResult),
      spoonacular: Boolean(spoonacularResult),
    },
    matchedBarcode:
      openFoodFactsResult?.matchedBarcode ||
      spoonacularResult?.matchedBarcode ||
      barcode,
    item: {
      name:
        offItem.name ||
        spoonProduct.title ||
        '',

      quantity:
        offItem.quantity ||
        servingSize ||
        '1 item',

      category:
        offItem.category ||
        spoonProduct.breadcrumbs?.[0] ||
        'Other',

      location:
        offItem.location ||
        'Pantry',

      expirationDate: '',

      barcode:
        openFoodFactsResult?.matchedBarcode ||
        spoonacularResult?.matchedBarcode ||
        barcode,

      brand:
        offItem.brand ||
        spoonProduct.brand ||
        '',

      imageUrl:
        offItem.imageUrl ||
        spoonProduct.image ||
        '',

      nutriScore,
      novaGroup,

      ingredients,
      normalizedIngredients,
      ingredientAnalysis,

      additives: offItem.additives || [],
      additivesCount,

      allergens: offItem.allergens || '',
      labels: offItem.labels || '',

      nutrition,

      servingSize,
      servingGrams,
      nutritionPerServing,

      healthScore,
      healthInsights,

      spoonacularBadges: spoonProduct.badges || [],
      spoonacularImportantBadges: spoonProduct.importantBadges || [],
      spoonacularGeneratedText: spoonProduct.generatedText || '',
    },
  };
}

function emptyBarcodeResult(barcode) {
  return {
    found: false,
    source: {
      openFoodFacts: false,
      spoonacular: false,
    },
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
      normalizedIngredients: [],
      ingredientAnalysis: [],
      additives: [],
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
      servingSize: '',
      servingGrams: null,
      nutritionPerServing: null,
      healthScore: null,
      healthInsights: [],
      spoonacularBadges: [],
      spoonacularImportantBadges: [],
      spoonacularGeneratedText: '',
    },
  };
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
      '/generate-recipes',
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

app.post('/lookup-barcode', async (req, res) => {
  console.log('🔥 /lookup-barcode HIT');
  console.log('Request body:', req.body);

  try {
    const barcode = normalizeBarcode(req.body?.barcode);

    if (!barcode) {
      return res.status(400).json({ error: 'Barcode is required' });
    }

    const [openFoodFactsResult, spoonacularResult] = await Promise.all([
      lookupOpenFoodFacts(barcode),
      lookupSpoonacularProduct(barcode),
    ]);

    console.log('Barcode lookup result:', {
      barcode,
      openFoodFacts: Boolean(openFoodFactsResult),
      spoonacular: Boolean(spoonacularResult),
    });

    if (openFoodFactsResult || spoonacularResult) {
      return res.json(
        buildMergedBarcodeResult({
          barcode,
          openFoodFactsResult,
          spoonacularResult,
        })
      );
    }

    return res.json(emptyBarcodeResult(barcode));
  } catch (error) {
    console.error('Barcode lookup error:', error);

    return res.status(500).json({
      error: 'Barcode lookup failed',
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