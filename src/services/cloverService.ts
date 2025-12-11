import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CLOVER_API_URL = process.env.CLOVER_API_URL || 'https://api.clover.com';
const CLOVER_API_KEY = process.env.CLOVER_API_KEY;
const CLOVER_MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;

export const getProducts = async () => {
  if (!CLOVER_API_KEY || !CLOVER_MERCHANT_ID) {
    console.warn('Clover API credentials missing.');
    return [];
  }

  try {
    const response = await axios.get(
      `${CLOVER_API_URL}/v3/merchants/${CLOVER_MERCHANT_ID}/items`,
      {
        headers: {
          'Authorization': `Bearer ${CLOVER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        params: {
            limit: 100 // Fetch first 100 items
        }
      }
    );
    return response.data.elements || [];
  } catch (error) {
    console.error('Error fetching products from Clover:', error);
    return [];
  }
};

