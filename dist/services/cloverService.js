"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProducts = void 0;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const CLOVER_API_URL = process.env.CLOVER_API_URL || 'https://api.clover.com';
const CLOVER_API_KEY = process.env.CLOVER_API_KEY;
const CLOVER_MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;
const getProducts = async () => {
    if (!CLOVER_API_KEY || !CLOVER_MERCHANT_ID) {
        console.warn('Clover API credentials missing.');
        return [];
    }
    try {
        const response = await axios_1.default.get(`${CLOVER_API_URL}/merchants/${CLOVER_MERCHANT_ID}/items`, {
            headers: {
                'Authorization': `Bearer ${CLOVER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: {
                limit: 100 // Fetch first 100 items
            }
        });
        return response.data.elements || [];
    }
    catch (error) {
        console.error('Error fetching products from Clover:', error);
        return [];
    }
};
exports.getProducts = getProducts;
