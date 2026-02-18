import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// ============================================================================
// CAMADA 1: DOMÍNIO (Entidades e Tipos)
// ============================================================================

// --- Value Objects ---
type Cents = number; 
type UUID = string;
type ISODate = string;
const APP_VERSION = "1.3.1";

// --- Constantes de Categoria ---
const EXPENSE_CATEGORIES = [
  'Alimentação', 'Veículo', 'Combustível', 'Imposto', 'Moradia', 
  'Lazer', 'Saúde', 'Educação', 'Pix/Transferência', 'Outros'
];

const INCOME_CATEGORIES = [
  'Salário', 'Rendimentos', 'Vendas', 'Reembolso', 'Pix Recebido', 'Outros'
];

const INVESTMENT_CATEGORIES = [
  'Ações', 'FIIs', 'Renda Fixa', 'Cripto', 'Stocks', 'Outros'
];

// --- Entidades ---

interface Account {
  id: UUID;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'WALLET';
  balance: Cents;
  currency: 'BRL' | 'USD';
}

interface CreditCard {
  id: UUID;
  name: string;
  limit: Cents;
  closingDay: number; 
  dueDay: number; 
  brand: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO' | 'OUTROS';
}

interface Transaction {
  id: UUID;
  description: string;
  amount: Cents;
  date: ISODate;
  type: 'INCOME' | 'EXPENSE' | 'INVESTMENT';
  investmentType?: 'BUY' | 'SELL'; // Novo campo para distinguir compra/venda
  category: string;
  accountId?: UUID; // Se débito/receita em conta
  cardId?: UUID;    // Se despesa crédito
  installment?: { current: number; total: number };
  isCleared: boolean;
  // Campos específicos de investimento
  assetTicker?: string;
  assetQuantity?: number;
  assetPrice?: Cents;
}

interface InvestmentAsset {
  id: UUID;
  ticker: string;
  quantity: number;
  averagePrice: Cents;
  currentPrice: Cents;
  type: 'STOCK' | 'FII' | 'CRYPTO' | 'FIXED';
  lastUpdate?: string;
}

interface CorporateAction {
  id: string;
  ticker: string;
  type: 'DIVIDEND' | 'JCP' | 'RENDIMENTO';
  amountPerShare: Cents;
  paymentDate: ISODate;
  dataCom: ISODate;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'INFO' | 'WARNING' | 'SUCCESS';
}

interface UserProfile {
  level: number;
  xp: number;
  achievements: string[];
}

// --- Aggregate Root (Estado Global) ---
interface AppState {
  accounts: Account[];
  creditCards: CreditCard[];
  transactions: Transaction[];
  assets: InvestmentAsset[];
  notifications: NotificationItem[];
  userProfile: UserProfile;
  // Novos campos para controle de reinvestimento
  processedCorporateActionIds: string[]; // IDs de dividendos já confirmados
  lastReinvestmentResetDate: string; // Data do último "zeramento" do saldo de reinvestimento
}

// ============================================================================
// CAMADA 2: DADOS E REGRAS DE NEGÓCIO (Serviços)
// ============================================================================

const MoneyService = {
  format: (amount: Cents): string => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(amount / 100);
  },
  parse: (val: number): Cents => Math.round(val * 100),
};

// Serviço Simulado de Bolsa de Valores (Para evitar chaves de API quebradas em demo)
const MarketDataService = {
  // Preços base aproximados (em centavos)
  BASE_PRICES: {
    'PETR4': 3650, 'VALE3': 6020, 'ITUB4': 3480, 'BBAS3': 2750, 'WEGE3': 5210,
    'HGLG11': 16500, 'MXRF11': 1045, 'KNRI11': 15890, 'XPML11': 11590,
    'BTC': 38000000, 'ETH': 1500000, 'USDT': 560
  } as Record<string, number>,

  // Simula busca de preço em tempo real com flutuação
  fetchPrice: async (ticker: string): Promise<Cents> => {
    // Simula delay de rede
    await new Promise(resolve => setTimeout(resolve, 300));

    const cleanTicker = ticker.toUpperCase().trim();
    const basePrice = MarketDataService.BASE_PRICES[cleanTicker] || 10000; // Default 100.00 se não achar
    
    // Gera flutuação aleatória entre -2% e +2%
    const variation = (Math.random() * 0.04) - 0.02; 
    const currentPrice = Math.round(basePrice * (1 + variation));
    
    return currentPrice;
  },

  // Simula calendário de proventos
  fetchUpcomingDividends: async (): Promise<CorporateAction[]> => {
    const today = new Date();
    
    // Helper para criar datas relativas
    const addDays = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    };

    // Usando IDs fixos baseados na data relativa para persistência funcionar no mock
    return [
      { id: `div-mxrf-${addDays(0)}`, ticker: 'MXRF11', type: 'RENDIMENTO', amountPerShare: 12, paymentDate: addDays(0), dataCom: addDays(-10) }, // Paga HOJE (para teste)
      { id: `div-xpml-${addDays(-1)}`, ticker: 'XPML11', type: 'RENDIMENTO', amountPerShare: 92, paymentDate: addDays(-1), dataCom: addDays(-8) }, // Pagou ONTEM (para teste)
      { id: `div-petr-${addDays(5)}`, ticker: 'PETR4', type: 'DIVIDEND', amountPerShare: 145, paymentDate: addDays(5), dataCom: addDays(-20) },
      { id: `div-vale-${addDays(12)}`, ticker: 'VALE3', type: 'JCP', amountPerShare: 233, paymentDate: addDays(12), dataCom: addDays(-30) },
      { id: `div-hglg-${addDays(15)}`, ticker: 'HGLG11', type: 'RENDIMENTO', amountPerShare: 110, paymentDate: addDays(15), dataCom: addDays(-15) },
      { id: `div-itub-${addDays(2)}`, ticker: 'ITUB4', type: 'JCP', amountPerShare: 15, paymentDate: addDays(2), dataCom: addDays(-30) }
    ];
  }
};

const CreditCardService = {
  generateInstallmentPlan: (
    card: CreditCard,
    amount: Cents,
    totalInstallments: number,
    description: string,
    category: string,
    purchaseDate: Date
  ): Transaction[] => {
    const transactions: Transaction[] = [];
    const installmentValue = Math.round(amount / totalInstallments);
    
    const pDate = new Date(purchaseDate);
    let targetMonth = pDate.getMonth();
    let targetYear = pDate.getFullYear();

    if (pDate.getDate() >= card.closingDay) {
      targetMonth++; 
    }

    for (let i = 0; i < totalInstallments; i++) {
      const dueDate = new Date(targetYear, targetMonth + 1 + i, card.dueDay);
      
      transactions.push({
        id: `txn-${Date.now()}-${i}`,
        description: `${description} (${i + 1}/${totalInstallments})`,
        amount: installmentValue,
        date: dueDate.toISOString(),
        type: 'EXPENSE',
        category: category,
        cardId: card.id,
        isCleared: false,
        installment: { current: i + 1, total: totalInstallments }
      });
    }

    return transactions;
  },

  calculateInvoiceTotal: (transactions: Transaction[], cardId: UUID, monthOffset: number = 0): Cents => {
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    
    return transactions
      .filter(t => t.cardId === cardId && t.type === 'EXPENSE')
      .filter(t => {
        const tDate = new Date(t.date);
        return tDate.getMonth() === targetDate.getMonth() && tDate.getFullYear() === targetDate.getFullYear();
      })
      .reduce((acc, t) => acc + t.amount, 0);
  },

  calculateTotalUsedLimit: (transactions: Transaction[], cardId: UUID): Cents => {
     return transactions
      .filter(t => t.cardId === cardId && t.type === 'EXPENSE' && !t.isCleared)
      .reduce((acc, t) => acc + t.amount, 0);
  }
};

const InvestmentService = {
  calculateNetWorth: (accounts: Account[], assets: InvestmentAsset[]): Cents => {
    const cash = accounts.reduce((acc, a) => acc + a.balance, 0);
    const invested = assets.reduce((acc, a) => acc + (a.quantity * a.currentPrice), 0);
    return cash + invested;
  },
  
  calculateHistory: (accounts: Account[], assets: InvestmentAsset[], transactions: Transaction[], days: number): number[] => {
    const history: number[] = [];
    let currentNetWorth = InvestmentService.calculateNetWorth(accounts, assets);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const sortedTxns = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    for (let i = 0; i < days; i++) {
      history.unshift(currentNetWorth);
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      targetDate.setHours(0, 0, 0, 0);
      const txnsOnThisDay = sortedTxns.filter(t => {
        const tDate = new Date(t.date);
        return tDate.getDate() === targetDate.getDate() && 
               tDate.getMonth() === targetDate.getMonth() && 
               tDate.getFullYear() === targetDate.getFullYear();
      });
      txnsOnThisDay.forEach(t => {
        if (t.type === 'INCOME' || (t.type === 'INVESTMENT' && t.investmentType === 'SELL')) {
          currentNetWorth -= t.amount;
        } else if (t.type === 'EXPENSE' || (t.type === 'INVESTMENT' && t.investmentType === 'BUY')) {
          currentNetWorth += t.amount;
        }
      });
    }
    return history;
  }
};

const AIService = {
    parseTransaction: async (text: string, state: AppState): Promise<Partial<Transaction> | null> => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Construir contexto para a IA
            const accountContext = state.accounts.map(a => `${a.name} (ID: ${a.id})`).join(', ');
            const cardContext = state.creditCards.map(c => `${c.name} (ID: ${c.id})`).join(', ');
            const today = new Date().toISOString();

            const prompt = `
                Analyze this financial transaction voice command: "${text}".
                Context:
                - Today's Date: ${today}
                - Available Accounts: ${accountContext}
                - Available Credit Cards: ${cardContext}
                - Categories: ${[...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].join(', ')}

                Instructions:
                1. Extract the amount.
                2. Determine type (INCOME or EXPENSE).
                3. Determine the best matching Category.
                4. Identify the Account ID or Card ID if mentioned (fuzzy match). If "Credit Card" is mentioned but no specific name, pick the first card. If "Debit" or "Account", pick first account if not specified.
                5. Format date as ISO string.
                
                Return ONLY valid JSON with this schema:
                {
                    "amount": number (in cents/integer),
                    "description": string (short description),
                    "type": "INCOME" | "EXPENSE",
                    "category": string,
                    "date": string (ISO),
                    "accountId": string | null,
                    "cardId": string | null
                }
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite-latest',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            if (response.text) {
                return JSON.parse(response.text);
            }
            return null;

        } catch (error) {
            console.error("AI Parse Error", error);
            // Fallback simples se a API falhar ou não tiver chave
            return null;
        }
    }
}

// ============================================================================
// CAMADA 3: APRESENTAÇÃO (UI Componentes & Gerenciamento de Estado)
// ============================================================================

// --- ÍCONES ---
const Icons = {
  Home: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  Card: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>,
  Bank: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l8-4 8 4v14M10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" /></svg>,
  TrendingUp: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>,
  Settings: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>,
  Plus: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>,
  Mic: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>,
  ArrowUp: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>,
  ArrowDown: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>,
  Exchange: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFAB00" strokeWidth="2"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>,
  Wallet: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"></path></svg>,
  Lock: () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  Edit: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
  Trash: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Bell: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>,
  Download: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>,
  Upload: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>,
  DollarSign: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>,
  Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>,
  Refresh: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
};

// --- COMPONENTES REUTILIZÁVEIS ---

const Card = ({ children, style, onClick }: any) => (
  <div onClick={onClick} style={{
    background: '#1e293b', borderRadius: 16, padding: 20,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    border: '1px solid rgba(255,255,255,0.05)',
    cursor: onClick ? 'pointer' : 'default',
    ...style
  }}>{children}</div>
);

// Input de Moeda com Máscara
const CurrencyInput = ({ value, onChange, label, autoFocus }: { value: Cents, onChange: (val: Cents) => void, label: string, autoFocus?: boolean }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Remove tudo que não for dígito
    const digits = e.target.value.replace(/\D/g, '');
    onChange(Number(digits));
  };

  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value / 100);

  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={{ fontSize: 12, color: '#94a3b8' }}>{label}</label>
      <input
        type="tel"
        value={formatted}
        onChange={handleChange}
        autoFocus={autoFocus}
        style={{ ...inputStyle, fontSize: 24, fontWeight: 'bold', color: '#00C853' }} 
      />
    </div>
  );
};

const RollingNumber = ({ value }: { value: number }) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => { setDisplay(value); }, [value]);
  return <span>{MoneyService.format(display)}</span>;
};

// --- GRÁFICOS ---

const NetWorthChart = ({ history }: { history: number[] }) => {
  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * 100;
    const max = Math.max(...history, 1);
    const min = Math.min(...history, 0);
    const range = max - min;
    const y = 100 - (((val - min) / (range || 1)) * 100);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="60" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{stopColor:'#00C853', stopOpacity:0.5}} />
          <stop offset="100%" style={{stopColor:'#00C853', stopOpacity:0}} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke="#00C853" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,100 ${points} 100,100`} fill="url(#grad)" />
    </svg>
  );
};

const TransactionRow = ({ t, onDelete }: { t: Transaction, onDelete?: (id: string) => void }) => {
  const isIncome = t.type === 'INCOME';
  const isInvestment = t.type === 'INVESTMENT';
  
  let color = '#FF5252';
  let bg = '#FF525222';
  let Icon = Icons.ArrowDown;
  let sign = '-';

  if (isIncome) {
    color = '#00C853';
    bg = '#00C85322';
    Icon = Icons.ArrowUp;
    sign = '+';
  } else if (isInvestment) {
    if (t.investmentType === 'SELL') {
      color = '#00C853'; // Venda = Entrada de Caixa
      bg = '#00C85322';
      Icon = Icons.Exchange;
      sign = '+';
    } else {
      color = '#FFAB00'; // Compra = Saída de Caixa (Investido)
      bg = '#FFAB0022';
      Icon = Icons.Exchange;
      sign = '';
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #ffffff08' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ background: bg, padding: 8, borderRadius: 8 }}>
          <Icon />
        </div>
        <div>
          <div style={{ fontWeight: 500 }}>{t.description}</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>
            {t.category} • {t.installment ? `${t.installment.current}/${t.installment.total}` : (isInvestment ? `${t.investmentType === 'SELL' ? 'Venda' : 'Compra'} ${t.assetTicker}` : 'À vista')} • {new Date(t.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ color: color, fontWeight: 600 }}>
            {sign}{MoneyService.format(t.amount)}
        </div>
        {onDelete && (
             <button 
             onClick={(e) => {
                 e.stopPropagation();
                 if(window.confirm('Excluir transação?')) onDelete(t.id);
             }} 
             style={{background: 'rgba(255, 255, 255, 0.1)', border: 'none', color: '#FF5252', cursor: 'pointer', padding: 10, borderRadius: 8, marginLeft: 8}}
            >
                <Icons.Trash />
            </button>
        )}
      </div>
    </div>
  );
};

// --- TELAS & WIDGETS ---

const HomeScreen = ({ state }: { state: AppState }) => {
  const netWorth = InvestmentService.calculateNetWorth(state.accounts, state.assets);
  
  // Calcula histórico baseado na primeira transação (max 90 dias)
  const history = useMemo(() => {
    let days = 30; // Default
    if (state.transactions.length > 0) {
        // Encontrar data da transação mais antiga
        const dates = state.transactions.map(t => new Date(t.date).getTime());
        const minDate = Math.min(...dates);
        const now = new Date().getTime();
        
        // Diferença em dias
        const diffTime = Math.abs(now - minDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        // Limita entre 1 dia e 90 dias
        days = Math.min(Math.max(diffDays, 1), 90);
    }
    return InvestmentService.calculateHistory(state.accounts, state.assets, state.transactions, days);
  }, [state.transactions, state.accounts, state.assets]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Patrimônio Líquido</h2>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700 }}><RollingNumber value={netWorth} /></h1>
        </div>
      </div>

      <Card style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Resumo Financeiro</h3>
        </div>
        <NetWorthChart history={history} />
      </Card>

      <h3 style={{ fontSize: 18, marginBottom: 16 }}>Resumo de Contas</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state.accounts.map(acc => (
          <Card key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: '#2979FF22', padding: 8, borderRadius: 8, color: '#2979FF' }}><Icons.Wallet /></div>
              <div>
                <div style={{ fontWeight: 600 }}>{acc.name}</div>
                <div style={{ fontSize: 12, opacity: 0.5 }}>{acc.type === 'CHECKING' ? 'Conta Corrente' : 'Poupança'}</div>
              </div>
            </div>
            <div style={{ fontWeight: 600 }}><RollingNumber value={acc.balance} /></div>
          </Card>
        ))}
        {state.accounts.length === 0 && <p style={{opacity: 0.5, fontSize: 14}}>Nenhuma conta. Vá em configurações.</p>}
      </div>
    </div>
  );
};

// --- COMPONENTE POP-UP DETALHE BANCO ---
const BankDetailModal = ({ account, transactions, onClose }: { account: Account | null, transactions: Transaction[], onClose: () => void }) => {
    if (!account) return null;

    // Calcular saldo no último dia do mês anterior
    const prevMonthBalance = useMemo(() => {
        const today = new Date();
        const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        
        // Transações que ocorreram NESTE mês (que alteraram o saldo até chegar no atual)
        const thisMonthTxns = transactions.filter(t => 
            t.accountId === account.id && new Date(t.date) >= startOfCurrentMonth
        );

        // Reverter saldo: SaldoAtual - Entradas + Saídas = Saldo Inicial do Mês
        let balance = account.balance;
        thisMonthTxns.forEach(t => {
            if (t.type === 'INCOME') {
                balance -= t.amount;
            } else if (t.type === 'EXPENSE') {
                balance += t.amount;
            } else if (t.type === 'INVESTMENT') {
                if (t.investmentType === 'SELL') balance -= t.amount; // Venda somou, então subtrai
                else balance += t.amount; // Compra subtraiu, então soma
            }
        });
        return balance;
    }, [account, transactions]);

    return (
        <Modal title={account.name} onClose={onClose}>
             <div style={{textAlign: 'center', marginBottom: 24}}>
                 <div style={{fontSize: 14, color: '#94a3b8'}}>Saldo Atual</div>
                 <div style={{fontSize: 32, fontWeight: 700, color: '#2979FF'}}>{MoneyService.format(account.balance)}</div>
             </div>
             
             <Card style={{background: '#ffffff05', border: 'none', marginBottom: 24}}>
                 <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                     <span style={{color: '#94a3b8'}}>Saldo Mês Anterior</span>
                     <span style={{fontWeight: 600}}>{MoneyService.format(prevMonthBalance)}</span>
                 </div>
                 <div style={{fontSize: 10, color: '#94a3b8', marginTop: 4}}>*Saldo no fechamento do último mês</div>
             </Card>

             <button onClick={onClose} style={{...btnStyle, background: '#334155'}}>Fechar</button>
        </Modal>
    );
}

const BankScreen = ({ state, onDeleteTransaction }: { state: AppState, onDeleteTransaction: (id: string) => void }) => {
  const [selectedBank, setSelectedBank] = useState<Account | null>(null);

  const bankTransactions = state.transactions
    .filter(t => t.accountId !== undefined)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, marginBottom: 24 }}>Bancos</h2>
      
      {/* Lista de Saldos */}
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16, marginBottom: 16 }}>
        {state.accounts.map(acc => (
          <div 
            key={acc.id} 
            onClick={() => setSelectedBank(acc)}
            style={{ minWidth: 200, background: '#1e293b', padding: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 14, color: '#94a3b8' }}>{acc.name}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{MoneyService.format(acc.balance)}</div>
          </div>
        ))}
        {state.accounts.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, width: '100%', opacity: 0.7, border: '1px dashed #ffffff33', borderRadius: 16 }}>
                Nenhuma conta cadastrada, vá em configurações para adicionar.
            </div>
        )}
      </div>

      <h3 style={{ fontSize: 18, marginBottom: 16 }}>Extrato Bancário</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bankTransactions.length > 0 ? bankTransactions.map(t => (
          <TransactionRow key={t.id} t={t} onDelete={onDeleteTransaction} />
        )) : <div style={{opacity: 0.5, textAlign: 'center', padding: 20}}>Nenhuma movimentação registrada.</div>}
      </div>

      <BankDetailModal 
        account={selectedBank} 
        transactions={state.transactions} 
        onClose={() => setSelectedBank(null)} 
      />
    </div>
  );
};

// --- COMPONENTE POP-UP DETALHE ATIVO ---
const AssetDetailModal = ({ 
    asset, 
    transactions, 
    dividends, 
    onClose, 
    onConfirmDividend,
    processedDividends
}: { 
    asset: InvestmentAsset | null, 
    transactions: Transaction[], 
    dividends: any[], 
    onClose: () => void,
    onConfirmDividend: (div: any) => void,
    processedDividends: string[]
}) => {
    if (!asset) return null;

    const totalPaid = asset.averagePrice * asset.quantity;
    const totalCurrent = asset.currentPrice * asset.quantity;
    const assetTransactions = transactions.filter(t => t.assetTicker === asset.ticker).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const upcomingDivs = dividends.filter(d => d.asset === asset.ticker);

    const isPayable = (dateStr: string) => {
        const today = new Date().toISOString().split('T')[0];
        return dateStr <= today;
    };

    return (
        <Modal title={asset.ticker} onClose={onClose}>
            <div style={{marginBottom: 24}}>
                 <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 16, background: '#ffffff05', padding: 16, borderRadius: 12}}>
                    <div>
                        <div style={{fontSize: 12, color: '#94a3b8'}}>Valor Investido</div>
                        <div style={{fontSize: 18, fontWeight: 600}}>{MoneyService.format(totalPaid)}</div>
                    </div>
                    <div style={{textAlign: 'right'}}>
                        <div style={{fontSize: 12, color: '#94a3b8'}}>Valor Atual</div>
                        <div style={{fontSize: 18, fontWeight: 700, color: totalCurrent >= totalPaid ? '#00C853' : '#FF5252'}}>{MoneyService.format(totalCurrent)}</div>
                    </div>
                 </div>

                 <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
                     <div>
                         <div style={{fontSize: 12, color: '#94a3b8'}}>Quantidade</div>
                         <div style={{fontSize: 16, fontWeight: 600}}>{asset.quantity}</div>
                     </div>
                     <div>
                         <div style={{fontSize: 12, color: '#94a3b8'}}>Cotação</div>
                         <div style={{fontSize: 16, fontWeight: 600}}>{MoneyService.format(asset.currentPrice)}</div>
                     </div>
                     <div>
                         <div style={{fontSize: 12, color: '#94a3b8'}}>Preço Médio (PM)</div>
                         <div style={{fontSize: 16, fontWeight: 600}}>{MoneyService.format(asset.averagePrice)}</div>
                     </div>
                 </div>
            </div>
            
            {/* PRÓXIMOS PROVENTOS */}
            {upcomingDivs.length > 0 && (
                <div style={{marginBottom: 24, padding: 16, background: 'rgba(0, 200, 83, 0.1)', borderRadius: 12, border: '1px solid rgba(0, 200, 83, 0.2)'}}>
                    <h4 style={{marginTop: 0, marginBottom: 12, fontSize: 14, color: '#00C853', display: 'flex', alignItems: 'center', gap: 6}}>
                        <Icons.DollarSign /> Próximos Proventos
                    </h4>
                    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                        {upcomingDivs.map((div, i) => {
                             // Defensive coding: ensure processedDividends is an array
                             const alreadyPaid = (processedDividends || []).includes(div.id);
                             const payable = isPayable(div.date);

                             return (
                             <div key={i} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, opacity: alreadyPaid ? 0.5 : 1}}>
                                <div>
                                    <div style={{fontWeight: 600}}>{div.type}</div>
                                    <div style={{fontSize: 11, opacity: 0.7}}>{new Date(div.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</div>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                    <div style={{fontWeight: 600, color: '#00C853', textAlign: 'right'}}>
                                        + {MoneyService.format(div.amount)}
                                        {alreadyPaid && <div style={{fontSize: 9}}>Recebido</div>}
                                    </div>
                                    {!alreadyPaid && payable && (
                                        <button 
                                            onClick={() => onConfirmDividend(div)}
                                            style={{
                                                background: '#00C853', color: 'white', border: 'none', 
                                                borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 4
                                            }}
                                        >
                                            <Icons.Check /> Receber
                                        </button>
                                    )}
                                </div>
                             </div>
                             )
                        })}
                    </div>
                </div>
            )}

            <h4 style={{marginBottom: 12, fontSize: 14, color: '#94a3b8', textTransform: 'uppercase'}}>Extrato</h4>
            <div style={{maxHeight: 200, overflowY: 'auto'}}>
                {assetTransactions.map(t => (
                    <div key={t.id} style={{display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #ffffff05', fontSize: 13}}>
                        <div style={{opacity: 0.7}}>
                            {new Date(t.date).toLocaleDateString('pt-BR')} • {t.investmentType === 'SELL' ? 'Venda' : 'Compra'}
                        </div>
                        <div style={{fontWeight: 600}}>
                            {t.assetQuantity} x {MoneyService.format(t.amount / (t.assetQuantity || 1))}
                        </div>
                    </div>
                ))}
            </div>
            <button onClick={onClose} style={{...btnStyle, marginTop: 24, background: '#334155'}}>Fechar</button>
        </Modal>
    )
}

const InvestmentsScreen = ({ state, onConfirmDividend, onResetReinvestment }: { state: AppState, onConfirmDividend: (d: any) => void, onResetReinvestment: () => void }) => {
  const totalInvested = state.assets.reduce((acc, asset) => acc + (asset.quantity * asset.currentPrice), 0);
  const [selectedAsset, setSelectedAsset] = useState<InvestmentAsset | null>(null);
  const [upcomingDividends, setUpcomingDividends] = useState<{id: string, asset: string, date: string, amount: number, type: string}[]>([]);

  useEffect(() => {
    const loadDividends = async () => {
        const dividends = await MarketDataService.fetchUpcomingDividends();
        // Filtrar apenas dos ativos que o usuário possui
        const myDividends = dividends
            .filter(div => state.assets.some(a => a.ticker === div.ticker))
            .map(div => {
                const asset = state.assets.find(a => a.ticker === div.ticker)!;
                return {
                    id: div.id,
                    asset: div.ticker,
                    date: div.paymentDate,
                    amount: div.amountPerShare * asset.quantity,
                    type: div.type
                };
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        setUpcomingDividends(myDividends);
    };
    loadDividends();
  }, [state.assets]);

  // Cálculo do Saldo para Reinvestimento
  const reinvestmentBalance = useMemo(() => {
      // 1. Dividendos Recebidos (Transações de INCOME com categoria 'Rendimentos') após a data de reset
      // 2. Vendas de Ativos (INVESTMENT SELL) após a data de reset
      const resetDate = new Date(state.lastReinvestmentResetDate || '1970-01-01');
      
      const earnings = state.transactions
        .filter(t => new Date(t.date) > resetDate)
        .filter(t => 
            (t.type === 'INCOME' && t.category === 'Rendimentos') || 
            (t.type === 'INVESTMENT' && t.investmentType === 'SELL')
        )
        .reduce((acc, t) => acc + t.amount, 0);
      
      return earnings;
  }, [state.transactions, state.lastReinvestmentResetDate]);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, marginBottom: 24 }}>Meus Investimentos</h2>
      
      <Card style={{ marginBottom: 24 }}>
         <div style={{ fontSize: 14, color: '#94a3b8' }}>Total em Ativos</div>
         <div style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}><RollingNumber value={totalInvested} /></div>
         
         {reinvestmentBalance > 0 && (
             <div style={{marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                 <div>
                    <div style={{fontSize: 12, color: '#94a3b8'}}>Disponível para Reinvestir</div>
                    <div 
                        onClick={() => {
                            if(window.confirm('Você já reinvestiu este valor (comprou novos ativos)? \n\nAo confirmar, este contador será zerado.')) {
                                onResetReinvestment();
                            }
                        }}
                        style={{fontSize: 16, fontWeight: 600, color: '#00C853', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6}}
                    >
                        {MoneyService.format(reinvestmentBalance)} <Icons.Refresh />
                    </div>
                 </div>
                 <div style={{fontSize: 10, opacity: 0.5}}>Clique para zerar</div>
             </div>
         )}
      </Card>

      <h3 style={{ fontSize: 18, marginBottom: 16 }}>Carteira</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state.assets.map(asset => {
          const totalVal = asset.quantity * asset.currentPrice;
          
          // Verificar se tem dividendo próximo (não processado)
          // Defensive coding: (state.processedCorporateActionIds || [])
          const nextDividend = upcomingDividends.find(d => d.asset === asset.ticker && !(state.processedCorporateActionIds || []).includes(d.id));

          return (
            <Card 
                key={asset.id} 
                onClick={() => setSelectedAsset(asset)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{asset.ticker}</div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                    {asset.quantity} un • {MoneyService.format(asset.currentPrice)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{MoneyService.format(totalVal)}</div>
                
                {nextDividend && (
                    <div style={{ fontSize: 11, color: '#00C853', marginTop: 4, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                       <div style={{width: 6, height: 6, borderRadius: '50%', background: '#00C853'}}></div>
                       + {MoneyService.format(nextDividend.amount)} ({new Date(nextDividend.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })})
                    </div>
                )}
              </div>
            </Card>
          );
        })}
        {state.assets.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>
             <Icons.TrendingUp />
             <p>Nenhum ativo na carteira. <br/>Use o botão + para adicionar um investimento.</p>
          </div>
        )}
      </div>

      <AssetDetailModal 
        asset={selectedAsset} 
        transactions={state.transactions} 
        dividends={upcomingDividends}
        onClose={() => setSelectedAsset(null)} 
        onConfirmDividend={onConfirmDividend}
        processedDividends={state.processedCorporateActionIds || []}
      />
    </div>
  );
};

const NotificationsScreen = ({ state }: { state: AppState }) => {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, marginBottom: 24 }}>Notificações</h2>
      
      {state.notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>
          <Icons.Bell />
          <p>Tudo limpo por aqui.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state.notifications.map(n => (
            <Card key={n.id} style={{ borderLeft: `4px solid ${n.type === 'SUCCESS' ? '#00C853' : n.type === 'WARNING' ? '#FFAB00' : '#2979FF'}` }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
              <div style={{ fontSize: 14, opacity: 0.8 }}>{n.message}</div>
              <div style={{ fontSize: 12, opacity: 0.4, marginTop: 8 }}>{new Date(n.date).toLocaleDateString('pt-BR')}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const CardsScreen = ({ state, onDeleteTransaction }: { state: AppState, onDeleteTransaction: (id: string) => void }) => {
  const [showAll, setShowAll] = useState(false);

  // Filtro de 7 dias
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const cardTransactions = state.transactions
    .filter(t => t.type === 'EXPENSE' && t.cardId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const visibleTransactions = showAll 
    ? cardTransactions 
    : cardTransactions.filter(t => new Date(t.date) >= sevenDaysAgo);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, marginBottom: 24 }}>Meus Cartões</h2>
      
      {state.creditCards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>
          <Icons.Card />
          <p>Nenhum cartão cadastrado. Vá em Configurações para adicionar.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {state.creditCards.map(card => {
            const currentInvoice = CreditCardService.calculateInvoiceTotal(state.transactions, card.id);
            const totalUsedLimit = CreditCardService.calculateTotalUsedLimit(state.transactions, card.id);
            const available = card.limit - totalUsedLimit;
            const usagePercent = (totalUsedLimit / card.limit) * 100;

            return (
              <Card key={card.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ fontWeight: 600, fontSize: 18 }}>{card.name}</span>
                  <span style={{ fontSize: 12, padding: '4px 8px', background: '#ffffff10', borderRadius: 4 }}>{card.brand}</span>
                </div>
                
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                    <span style={{ color: '#94a3b8' }}>Fatura Atual</span>
                    <span style={{ color: '#FF5252', fontWeight: 600 }}>{MoneyService.format(currentInvoice)}</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: '#334155', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ width: `${Math.min(usagePercent, 100)}%`, height: '100%', background: usagePercent > 90 ? '#FF5252' : usagePercent > 70 ? '#FFAB00' : '#2979FF', transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8, opacity: 0.8 }}>
                    <span>Disponível: <span style={{color: '#00C853'}}>{MoneyService.format(available)}</span></span>
                    <span>Total: {MoneyService.format(card.limit)}</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.5 }}>
                  Fecha dia {card.closingDay} • Vence dia {card.dueDay}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 }}>
        <h3 style={{ fontSize: 18, margin: 0 }}>{showAll ? 'Todas as Faturas' : 'Últimos Lançamentos'}</h3>
        <button onClick={() => setShowAll(!showAll)} style={{ background: 'none', border: 'none', color: '#2979FF', fontSize: 14, fontWeight: 600 }}>
          {showAll ? 'Ver Menos' : 'Ver Extrato Completo'}
        </button>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleTransactions.length > 0 ? visibleTransactions.map(t => (
           <TransactionRow key={t.id} t={t} onDelete={onDeleteTransaction} />
        )) : <p style={{opacity: 0.5}}>Nenhum gasto registrado neste período.</p>}
      </div>
    </div>
  );
};

const SettingsScreen = ({ 
  state, 
  onSaveCard, 
  onDeleteCard, 
  onSaveAccount, 
  onDeleteAccount,
  onImportData
}: { 
  state: AppState, 
  onSaveCard: (c: CreditCard) => void, 
  onDeleteCard: (id: string) => void,
  onSaveAccount: (a: Account) => void,
  onDeleteAccount: (id: string) => void,
  onImportData: (data: AppState) => void
}) => {
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isCardModalOpen, setCardModalOpen] = useState(false);
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  
  const [cardForm, setCardForm] = useState({ id: '', name: '', limit: '', closing: '', due: '', brand: 'MASTERCARD' });
  const [accountForm, setAccountForm] = useState({ id: '', name: '', type: 'CHECKING' });
  
  // Update state
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openCardModal = (card?: CreditCard) => {
    if (card) {
      setCardForm({
        id: card.id,
        name: card.name,
        limit: (card.limit / 100).toFixed(2),
        closing: card.closingDay.toString(),
        due: card.dueDay.toString(),
        brand: card.brand
      });
      setEditingCard(card);
    } else {
      setCardForm({ id: '', name: '', limit: '', closing: '', due: '', brand: 'MASTERCARD' });
      setEditingCard(null);
    }
    setCardModalOpen(true);
  };

  const openAccountModal = (account?: Account) => {
    if (account) {
      setAccountForm({
        id: account.id,
        name: account.name,
        type: account.type
      });
      setEditingAccount(account);
    } else {
      setAccountForm({ id: '', name: '', type: 'CHECKING' });
      setEditingAccount(null);
    }
    setAccountModalOpen(true);
  }

  const handleCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCard({
      id: editingCard ? editingCard.id : `card-${Date.now()}`,
      name: cardForm.name,
      limit: MoneyService.parse(parseFloat(cardForm.limit)),
      closingDay: parseInt(cardForm.closing),
      dueDay: parseInt(cardForm.due),
      brand: cardForm.brand as any
    });
    setCardModalOpen(false);
  };

  const handleAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAccount({
      id: editingAccount ? editingAccount.id : `acc-${Date.now()}`,
      name: accountForm.name,
      balance: editingAccount ? editingAccount.balance : 0, 
      type: accountForm.type as any,
      currency: 'BRL'
    });
    setAccountModalOpen(false);
  }

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `zenith_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target?.result as string);
            // Validação simples
            if (json.accounts && json.transactions) {
                onImportData(json);
                alert('Dados importados com sucesso!');
            } else {
                alert('Arquivo inválido.');
            }
        } catch (err) {
            alert('Erro ao ler arquivo.');
        }
    };
    reader.readAsText(file);
  };

  const handleCheckUpdate = () => {
    setCheckingUpdate(true);
    // Simula delay de rede
    setTimeout(() => {
        setCheckingUpdate(false);
        // Simula que achou uma versão nova
        setUpdateAvailable(true);
    }, 2000);
  };

  const handleUpdateApp = () => {
    if (window.confirm("Instalar atualização agora? O aplicativo será recarregado.")) {
        window.location.reload();
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, margin: 0 }}>Configurações</h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>Ver. {APP_VERSION}</span>
      </div>

      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>Contas Bancárias</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {state.accounts.map(a => (
             <div key={a.id} style={{ background: '#1e293b', padding: 16, borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                   <div style={{fontWeight: 600}}>{a.name}</div>
                   <div style={{fontSize: 12, opacity: 0.6}}>{a.type === 'CHECKING' ? 'Corrente' : 'Poupança'}</div>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                  <button onClick={() => openAccountModal(a)} style={iconBtnStyle}><Icons.Edit /></button>
                  <button onClick={() => onDeleteAccount(a.id)} style={{...iconBtnStyle, color: '#FF5252'}}><Icons.Trash /></button>
                </div>
             </div>
          ))}
        </div>
        <button onClick={() => openAccountModal()} style={actionBtnStyle}>+ Adicionar Conta Bancária</button>
      </div>

      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>Cartões de Crédito</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {state.creditCards.map(c => (
             <div key={c.id} style={{ background: '#1e293b', padding: 16, borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{fontWeight: 600}}>{c.name}</div>
                  <div style={{fontSize: 12, opacity: 0.6}}>{c.brand} • Limite: {MoneyService.format(c.limit)}</div>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                  <button onClick={() => openCardModal(c)} style={iconBtnStyle}><Icons.Edit /></button>
                  <button onClick={() => onDeleteCard(c.id)} style={{...iconBtnStyle, color: '#FF5252'}}><Icons.Trash /></button>
                </div>
             </div>
          ))}
        </div>
        <button onClick={() => openCardModal()} style={actionBtnStyle}>+ Adicionar Cartão de Crédito</button>
      </div>

      <div style={{ marginBottom: 32, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8' }}>Sistema</h3>
        <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
                <div style={{ fontWeight: 600 }}>Versão {APP_VERSION}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {updateAvailable ? 'Nova versão 1.3.0 disponível' : 'Seu app está atualizado'}
                </div>
            </div>
            <div>
                {updateAvailable ? (
                     <button onClick={handleUpdateApp} style={{...btnStyle, width: 'auto', padding: '8px 16px', fontSize: 12, background: '#00C853'}}>
                        Atualizar
                     </button>
                ) : (
                     <button onClick={handleCheckUpdate} disabled={checkingUpdate} style={{...actionBtnStyle, width: 'auto', padding: '8px 16px', fontSize: 12, opacity: checkingUpdate ? 0.5 : 1}}>
                        {checkingUpdate ? 'Buscando...' : 'Verificar'}
                     </button>
                )}
            </div>
        </div>
      </div>

      <div style={{ marginBottom: 32, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8' }}>Dados e Backup</h3>
        <div style={{display: 'flex', gap: 12}}>
            <button onClick={handleExport} style={{...actionBtnStyle, padding: '12px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}>
                <div style={{ transform: 'scale(0.8)' }}><Icons.Download /></div>
                Exportar
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{...actionBtnStyle, padding: '12px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}>
                <div style={{ transform: 'scale(0.8)' }}><Icons.Upload /></div>
                Importar
            </button>
            <input type="file" ref={fileInputRef} onChange={handleImport} style={{display: 'none'}} accept=".json" />
        </div>
      </div>

      {isCardModalOpen && (
        <Modal title={editingCard ? "Editar Cartão" : "Novo Cartão"} onClose={() => setCardModalOpen(false)}>
            <form onSubmit={handleCardSubmit}>
              <Input label="Nome" value={cardForm.name} onChange={(e: any) => setCardForm({...cardForm, name: e.target.value})} />
              <Input label="Limite (R$)" type="number" value={cardForm.limit} onChange={(e: any) => setCardForm({...cardForm, limit: e.target.value})} />
              <div style={{display:'flex', gap: 12}}>
                <Input label="Dia Fechamento" type="number" value={cardForm.closing} onChange={(e: any) => setCardForm({...cardForm, closing: e.target.value})} />
                <Input label="Dia Vencimento" type="number" value={cardForm.due} onChange={(e: any) => setCardForm({...cardForm, due: e.target.value})} />
              </div>
              <button type="submit" style={btnStyle}>Salvar</button>
            </form>
        </Modal>
      )}

      {isAccountModalOpen && (
        <Modal title={editingAccount ? "Editar Conta" : "Nova Conta"} onClose={() => setAccountModalOpen(false)}>
            <form onSubmit={handleAccountSubmit}>
               <Input label="Nome do Banco" value={accountForm.name} onChange={(e: any) => setAccountForm({...accountForm, name: e.target.value})} />
               <div style={{marginBottom: 16}}>
                 <label style={{display:'block', fontSize:12, color:'#94a3b8', marginBottom:4}}>Tipo</label>
                 <select style={inputStyle} value={accountForm.type} onChange={(e: any) => setAccountForm({...accountForm, type: e.target.value})}>
                   <option value="CHECKING">Conta Corrente</option>
                   <option value="SAVINGS">Poupança/Investimento</option>
                   <option value="WALLET">Carteira Física</option>
                 </select>
               </div>
               <button type="submit" style={btnStyle}>Salvar</button>
            </form>
        </Modal>
      )}
    </div>
  );
};

const Modal = ({ title, onClose, children }: any) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
  }} onClick={onClose}>
    <div style={{
      background: '#0f172a', width: '100%', maxWidth: 400, borderRadius: 24, padding: 24, border: '1px solid #334155'
    }} onClick={e => e.stopPropagation()}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  </div>
);

const Input = ({ label, ...props }: any) => (
  <div style={{ marginBottom: 12, flex: 1 }}>
    <label style={{ fontSize: 12, color: '#94a3b8' }}>{label}</label>
    <input required style={inputStyle} {...props} />
  </div>
);

const inputStyle = { width: '100%', background: '#334155', border: 'none', borderRadius: 8, padding: 12, color: 'white', marginTop: 4, outline: 'none' };
const btnStyle = { width: '100%', padding: 14, background: '#2979FF', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer' };
const actionBtnStyle = { width: '100%', padding: 16, background: '#1e293b', border: '1px dashed #334155', color: '#2979FF', borderRadius: 12, fontWeight: 600, cursor: 'pointer' };
const iconBtnStyle = { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 8 };

// --- MODAL DE TRANSAÇÃO (REESTRUTURADO & CORRIGIDO) ---

const TransactionModal = ({ isOpen, onClose, state, onSave, initialData }: any) => {
  const [mode, setMode] = useState<'REGULAR' | 'INVESTMENT'>('REGULAR'); // Top Level Toggle
  const [txnType, setTxnType] = useState<'INCOME' | 'EXPENSE' | 'TRANSFER'>('EXPENSE'); // Sub toggle for Regular
  
  const [amount, setAmount] = useState<Cents>(0); 
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(''); 
  const [method, setMethod] = useState<string>(''); 
  const [installments, setInstallments] = useState(1);
  const [category, setCategory] = useState('');
  
  // Fields for Transfer
  const [destAccount, setDestAccount] = useState<string>('');
  
  // Investment specific fields
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');

  useEffect(() => {
    if(isOpen) {
      // PREENCHIMENTO AUTOMÁTICO SE HOUVER INITIAL DATA (VOICE AI)
      if (initialData) {
          setAmount(initialData.amount || 0);
          setDescription(initialData.description || '');
          setDate(initialData.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
          setMode('REGULAR'); // AI for now only supports regular transactions
          setTxnType(initialData.type || 'EXPENSE');
          setCategory(initialData.category || EXPENSE_CATEGORIES[0]);
          
          // Tentar encontrar conta ou cartão
          if (initialData.cardId) {
             setMethod(initialData.cardId);
          } else if (initialData.accountId) {
             setMethod(initialData.accountId);
          } else {
             // Fallback
             setMethod(state.accounts[0]?.id || '');
          }

      } else {
        // DEFAULT RESET
        setMethod(state.accounts[0]?.id || '');
        setDestAccount(state.accounts.length > 1 ? state.accounts[1].id : '');
        setCategory(EXPENSE_CATEGORIES[0]);
        setInstallments(1);
        setAmount(0);
        setDescription('');
        setTicker('');
        setQuantity('');
        setDate(new Date().toISOString().split('T')[0]); 
        setMode('REGULAR');
        setTxnType('EXPENSE');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData]); 

  // Update default selections when type changes (only if not using initial data logic)
  useEffect(() => {
    if (!initialData) {
        if (mode === 'INVESTMENT') {
        setCategory(INVESTMENT_CATEGORIES[0]);
        setMethod(state.accounts[0]?.id || '');
        } else {
            if (txnType === 'INCOME') {
                setCategory(INCOME_CATEGORIES[0]);
                setMethod(state.accounts[0]?.id || '');
            } else if (txnType === 'EXPENSE') {
                setCategory(EXPENSE_CATEGORIES[0]);
                setMethod(state.creditCards[0]?.id || state.accounts[0]?.id || '');
            } else if (txnType === 'TRANSFER') {
                setCategory('Transferência');
                setMethod(state.accounts[0]?.id || '');
                if(state.accounts.length > 1 && state.accounts[0]?.id === state.accounts[1]?.id) {
                    // Try to pick different dest
                }
            }
        }
    }
  }, [mode, txnType, state.accounts, state.creditCards]);

  const handleSubmit = (e: React.FormEvent, investmentAction?: 'BUY' | 'SELL') => {
    e.preventDefault();
    if (!amount || !date) return;
    
    // Validations
    if (mode === 'REGULAR' && !description && txnType !== 'TRANSFER') return;
    if (mode === 'INVESTMENT' && (!ticker || !quantity)) return;
    if (txnType === 'TRANSFER' && (!method || !destAccount || method === destAccount)) {
        alert("Selecione contas de origem e destino diferentes.");
        return;
    }

    const val = amount;
    const selectedDate = new Date(date);
    
    if (mode === 'REGULAR') {
        if (txnType === 'TRANSFER') {
             // Generate 2 Transactions
             const originAcc = state.accounts.find((a: Account) => a.id === method);
             const destAcc = state.accounts.find((a: Account) => a.id === destAccount);
             
             const txnOut: Transaction = {
                id: `txn-${Date.now()}-out`, description: `Transf. para ${destAcc?.name}`, amount: val, date: selectedDate.toISOString(),
                type: 'EXPENSE', category: 'Transferência', accountId: method, isCleared: true
             };
             const txnIn: Transaction = {
                id: `txn-${Date.now()}-in`, description: `Recebido de ${originAcc?.name}`, amount: val, date: selectedDate.toISOString(),
                type: 'INCOME', category: 'Transferência', accountId: destAccount, isCleared: true
             };
             onSave([txnOut, txnIn]);
        
        } else if (txnType === 'EXPENSE') {
            const card = state.creditCards.find((c: CreditCard) => c.id === method);
            if (card) {
                const txns = CreditCardService.generateInstallmentPlan(
                card, val, installments, description, category, selectedDate
                );
                onSave(txns);
            } else {
                const txn: Transaction = {
                id: `txn-${Date.now()}`, description, amount: val, date: selectedDate.toISOString(),
                type: 'EXPENSE', category, accountId: method, isCleared: true
                };
                onSave([txn]);
            }
        } else {
            // INCOME
            const txn: Transaction = {
                id: `txn-${Date.now()}`, description, amount: val, date: selectedDate.toISOString(),
                type: 'INCOME', category, accountId: method, isCleared: true
            };
            onSave([txn]);
        }
    } else {
      // INVESTMENT
      const action = investmentAction || 'BUY';
      const txn: Transaction = {
        id: `txn-${Date.now()}`, 
        description: `${action === 'BUY' ? 'Compra' : 'Venda'} ${ticker}`, 
        amount: val, 
        date: selectedDate.toISOString(),
        type: 'INVESTMENT', 
        investmentType: action,
        category: category, 
        accountId: method, 
        isCleared: true,
        assetTicker: ticker.toUpperCase(),
        assetQuantity: parseFloat(quantity),
        assetPrice: val / parseFloat(quantity)
      };
      onSave([txn]);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal title="Novo Lançamento" onClose={onClose}>
      
      {/* Top Level Toggle: Investment vs Regular */}
      <div style={{ display: 'flex', background: '#1e293b', padding: 4, borderRadius: 12, marginBottom: 16 }}>
        <button onClick={() => setMode('INVESTMENT')} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', fontWeight: 600, background: mode === 'INVESTMENT' ? '#FFAB00' : 'transparent', color: mode === 'INVESTMENT' ? 'white' : '#94a3b8', transition: 'all 0.2s', cursor: 'pointer', fontSize: 13}}>Investimentos</button>
        <button onClick={() => setMode('REGULAR')} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', fontWeight: 600, background: mode === 'REGULAR' ? '#2979FF' : 'transparent', color: mode === 'REGULAR' ? 'white' : '#94a3b8', transition: 'all 0.2s', cursor: 'pointer', fontSize: 13}}>Despesa / Receita</button>
      </div>

      {/* Sub Toggle if Regular */}
      {mode === 'REGULAR' && (
          <div style={{ display: 'flex', background: '#334155', padding: 2, borderRadius: 8, marginBottom: 24, width: '100%' }}>
            <button onClick={() => setTxnType('EXPENSE')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 'none', fontWeight: 600, background: txnType === 'EXPENSE' ? '#FF5252' : 'transparent', color: txnType === 'EXPENSE' ? 'white' : '#94a3b8', transition: 'all 0.2s', cursor: 'pointer', fontSize: 12}}>Despesa</button>
            <button onClick={() => setTxnType('INCOME')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 'none', fontWeight: 600, background: txnType === 'INCOME' ? '#00C853' : 'transparent', color: txnType === 'INCOME' ? 'white' : '#94a3b8', transition: 'all 0.2s', cursor: 'pointer', fontSize: 12}}>Receita</button>
            <button onClick={() => setTxnType('TRANSFER')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 'none', fontWeight: 600, background: txnType === 'TRANSFER' ? '#64748b' : 'transparent', color: txnType === 'TRANSFER' ? 'white' : '#94a3b8', transition: 'all 0.2s', cursor: 'pointer', fontSize: 12}}>Transferência</button>
          </div>
      )}

      <form onSubmit={(e) => handleSubmit(e)}>
        <CurrencyInput label="Valor Total" value={amount} onChange={setAmount} autoFocus />

        {/* 1. SELEÇÃO DE PAGAMENTO (AGORA ABAIXO DO VALOR) */}
        
        {txnType === 'TRANSFER' ? (
           <div style={{display: 'flex', gap: 12, marginBottom: 12}}>
              <div style={{flex: 1}}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>De (Origem)</label>
                  <select value={method} onChange={e => setMethod(e.target.value)} style={inputStyle}>
                    {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
              </div>
              <div style={{flex: 1}}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Para (Destino)</label>
                  <select value={destAccount} onChange={e => setDestAccount(e.target.value)} style={inputStyle}>
                    {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
              </div>
           </div>
        ) : (
            <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>
                {mode === 'INVESTMENT' ? 'Origem do Recurso' : (txnType === 'INCOME' ? 'Conta Destino' : 'Pagamento')}
                </label>
                <select value={method} onChange={e => setMethod(e.target.value)} style={inputStyle}>
                <optgroup label="Contas Bancárias">
                    {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </optgroup>
                {mode === 'REGULAR' && txnType === 'EXPENSE' && (
                    <optgroup label="Cartões de Crédito">
                    {state.creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                )}
                </select>
            </div>
        )}

        {/* 2. PARCELAMENTO (DESTAQUE SE FOR CARTÃO) */}
        {mode === 'REGULAR' && txnType === 'EXPENSE' && state.creditCards.find(c => c.id === method) && (
          <div style={{ marginBottom: 16, background: '#1e293b', padding: 12, borderRadius: 12, border: '1px solid #ffffff10' }}>
            <label style={{ display: 'block', color: '#2979FF', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Parcelamento</label>
            <select value={installments} onChange={e => setInstallments(Number(e.target.value))} style={{...inputStyle, background: '#0f172a', border: '1px solid #2979FF'}}>
              {[...Array(12)].map((_, i) => (
                <option key={i} value={i+1}>{i+1}x {amount ? MoneyService.format(Math.round(amount / (i+1))) : ''}</option>
              ))}
            </select>
          </div>
        )}
        
        {/* 3. CAMPOS ESPECÍFICOS */}
        {mode === 'INVESTMENT' ? (
          <div style={{display: 'flex', gap: 12}}>
            <Input label="Código (Ticker)" placeholder="PETR4" value={ticker} onChange={(e: any) => setTicker(e.target.value.toUpperCase())} />
            <Input label="Quantidade" type="number" step="0.01" value={quantity} onChange={(e: any) => setQuantity(e.target.value)} />
          </div>
        ) : (
          txnType !== 'TRANSFER' && <Input label="Descrição" type="text" placeholder="Ex: Almoço" value={description} onChange={(e: any) => setDescription(e.target.value)} />
        )}
        
        {/* 4. DATA E CATEGORIA */}
        <div style={{display: 'flex', gap: 12}}>
            <Input label="Data" type="date" value={date} onChange={(e: any) => setDate(e.target.value)} />
            
            {txnType !== 'TRANSFER' && (
                <div style={{flex: 1, marginBottom: 12}}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Categoria</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                        {(mode === 'INVESTMENT' ? INVESTMENT_CATEGORIES : (txnType === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
            )}
        </div>

        {/* Action Buttons */}
        {mode === 'INVESTMENT' ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" onClick={(e) => handleSubmit(e, 'BUY')} style={{...btnStyle, background: '#00C853'}}>Comprar</button>
                <button type="button" onClick={(e) => handleSubmit(e, 'SELL')} style={{...btnStyle, background: '#FF5252'}}>Vender</button>
            </div>
        ) : (
            <button type="submit" style={{...btnStyle, marginTop: 12}}>Confirmar</button>
        )}
      </form>
    </Modal>
  );
};

// --- COMPONENTE DE ESCUTA DE VOZ (VISUAL) ---
const VoiceListeningOverlay = ({ isListening }: { isListening: boolean }) => {
    if (!isListening) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.8)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                width: 100, height: 100, borderRadius: '50%', background: '#2979FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 40px #2979FF', animation: 'pulse 1.5s infinite'
            }}>
                <Icons.Mic />
            </div>
            <h2 style={{marginTop: 32, color: 'white'}}>Ouvindo...</h2>
            <p style={{color: '#94a3b8'}}>Fale: "Gastei 50 reais no almoço..."</p>
            <style>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.1); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    )
}

// --- PONTO DE ENTRADA DO APP ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'HOME' | 'NOTIFICATIONS' | 'CARDS' | 'BANKS' | 'INVESTMENTS' | 'SETTINGS'>('HOME');
  const [isModalOpen, setModalOpen] = useState(false);
  const [locked, setLocked] = useState(true);

  // Voice State
  const [isListening, setIsListening] = useState(false);
  const [voiceDraftData, setVoiceDraftData] = useState<any>(null);
  const recognitionRef = useRef<any>(null);

  // Estado Inicial
  const initialState: AppState = {
    accounts: [],
    creditCards: [],
    transactions: [],
    assets: [],
    notifications: [],
    userProfile: { level: 1, xp: 0, achievements: [] },
    processedCorporateActionIds: [],
    lastReinvestmentResetDate: new Date('2024-01-01').toISOString()
  };

  const [state, setState] = useState<AppState>(initialState);

  // Persistência Offline
  useEffect(() => {
    const saved = localStorage.getItem('zenith_superapp_v3_br');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            // MIGRATION: Ensure new fields exist
            setState(prev => ({
                ...prev, // Default structure
                ...loaded, // Saved data overrides
                processedCorporateActionIds: loaded.processedCorporateActionIds || [],
                lastReinvestmentResetDate: loaded.lastReinvestmentResetDate || prev.lastReinvestmentResetDate
            }));
        } catch (e) {
            console.error("Error loading state", e);
        }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('zenith_superapp_v3_br', JSON.stringify(state));
  }, [state]);

  // --- HEALTH CHECK: Monitoramento de Limites e Prazos ---
  useEffect(() => {
      const checkSystemHealth = async () => {
          const alerts: NotificationItem[] = [];
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          const dayOfMonth = today.getDate();
          
          // Data de amanhã para notificação de dividendos
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().split('T')[0];

          // 1. Verificar Contas Negativas
          state.accounts.forEach(acc => {
              if (acc.balance < 0) {
                  const id = `alert-balance-neg-${acc.id}-${todayStr}`;
                  if (!state.notifications.find(n => n.id === id)) {
                      alerts.push({
                          id,
                          title: 'Conta no Vermelho',
                          message: `A conta ${acc.name} está negativa em ${MoneyService.format(acc.balance)}.`,
                          date: today.toISOString(),
                          type: 'WARNING',
                          read: false
                      });
                  }
              }
          });

          // 2. Verificar Cartões de Crédito
          state.creditCards.forEach(card => {
              // A. Limites
              const usedLimit = CreditCardService.calculateTotalUsedLimit(state.transactions, card.id);
              const usagePercent = usedLimit / card.limit;
              
              let limitAlertTitle = '';
              let limitAlertMsg = '';
              let limitAlertType: 'WARNING' | 'INFO' = 'WARNING';
              let trigger = false;

              if (usagePercent >= 1.0) {
                  limitAlertTitle = 'Limite Esgotado!';
                  limitAlertMsg = `Você atingiu 100% do limite do cartão ${card.name}.`;
                  limitAlertType = 'WARNING'; // Critical visualmente será Warning no nosso tema
                  trigger = true;
              } else if (usagePercent >= 0.9) {
                  limitAlertTitle = 'Atenção ao Limite';
                  limitAlertMsg = `Você já usou 90% do limite do cartão ${card.name}.`;
                  trigger = true;
              } else if (usagePercent >= 0.8) {
                  limitAlertTitle = 'Gestão de Limite';
                  limitAlertMsg = `Você ultrapassou 80% do limite do cartão ${card.name}.`;
                  limitAlertType = 'INFO';
                  trigger = true;
              }

              if (trigger) {
                   // ID único por dia para não spamar
                   const id = `alert-limit-${Math.floor(usagePercent*100)}-${card.id}-${todayStr}`;
                   if (!state.notifications.find(n => n.id === id)) {
                       alerts.push({
                           id,
                           title: limitAlertTitle,
                           message: limitAlertMsg,
                           date: today.toISOString(),
                           type: limitAlertType,
                           read: false
                       });
                   }
              }

              // B. Datas da Fatura
              // Fechamento
              if (dayOfMonth === card.closingDay) {
                  const id = `alert-invoice-close-${card.id}-${todayStr}`;
                  if (!state.notifications.find(n => n.id === id)) {
                      alerts.push({
                          id,
                          title: 'Fatura Fechada',
                          message: `A fatura do cartão ${card.name} fecha hoje.`,
                          date: today.toISOString(),
                          type: 'INFO',
                          read: false
                      });
                  }
              }

              // Vencimento
              if (dayOfMonth === card.dueDay) {
                  const id = `alert-invoice-due-${card.id}-${todayStr}`;
                  if (!state.notifications.find(n => n.id === id)) {
                      alerts.push({
                          id,
                          title: 'Fatura Vence Hoje',
                          message: `Não esqueça de pagar a fatura do ${card.name} para evitar juros.`,
                          date: today.toISOString(),
                          type: 'WARNING',
                          read: false
                      });
                  }
              }
          });
          
          // 3. Verificar Provisão de Dividendos (Pagamento Amanhã)
          if (state.assets.length > 0) {
            const divs = await MarketDataService.fetchUpcomingDividends();
            divs.forEach(div => {
                // Checa se o pagamento é amanhã
                if (div.paymentDate === tomorrowStr) {
                    const myAsset = state.assets.find(a => a.ticker === div.ticker);
                    if (myAsset && myAsset.quantity > 0) {
                        const totalAmount = myAsset.quantity * div.amountPerShare;
                        const typeName = div.type === 'JCP' ? 'JCP' : (div.type === 'RENDIMENTO' ? 'Rendimentos' : 'Dividendos');
                        const id = `alert-div-${div.ticker}-${tomorrowStr}`;
                        
                        // Só notifica se ainda não foi processado
                        if (!state.notifications.find(n => n.id === id) && !(state.processedCorporateActionIds || []).includes(div.id)) {
                            alerts.push({
                                id,
                                title: 'Entrada de Proventos',
                                message: `${typeName} de ${div.ticker} no valor de ${MoneyService.format(totalAmount)} caem amanhã!`,
                                date: today.toISOString(),
                                type: 'SUCCESS',
                                read: false
                            });
                        }
                    }
                }
            });
          }

          if (alerts.length > 0) {
              setState(prev => ({
                  ...prev,
                  notifications: [...alerts, ...prev.notifications]
              }));
          }
      };
      
      checkSystemHealth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.transactions, state.accounts, state.creditCards, state.assets, state.processedCorporateActionIds]); 

  // Efeito de Atualização da Bolsa (Ticker em Tempo Real)
  useEffect(() => {
    const updateMarketData = async () => {
      if (state.assets.length === 0) return;

      const updatedAssets = await Promise.all(state.assets.map(async (asset) => {
        const newPrice = await MarketDataService.fetchPrice(asset.ticker);
        return { ...asset, currentPrice: newPrice };
      }));
      
      // Só atualiza se houver mudança para evitar re-render desnecessário
      setState(prev => ({...prev, assets: updatedAssets}));
    };

    const interval = setInterval(updateMarketData, 30000); // Atualiza a cada 30s
    updateMarketData(); // Primeira chamada

    return () => clearInterval(interval);
  }, [state.assets.length]); // Depende apenas se o tamanho do array mudar

  const handleImportData = (newState: AppState) => {
      setState(newState);
  }

  // --- CONFIRMAÇÃO DE DIVIDENDOS ---
  const handleConfirmDividend = (dividend: {id: string, asset: string, amount: number, type: string}) => {
      // Pergunta em qual conta caiu
      if(state.accounts.length === 0) {
          alert('Adicione uma conta bancária primeiro para receber os proventos.');
          return;
      }
      
      // Default para a primeira conta se o usuário não quiser escolher complexamente aqui
      const accountId = state.accounts[0].id; // Simplificação: cai na primeira conta
      
      const confirm = window.confirm(`Confirmar recebimento de ${MoneyService.format(dividend.amount)} na conta ${state.accounts[0].name}?`);
      if(!confirm) return;

      const newTxn: Transaction = {
          id: `div-txn-${Date.now()}`,
          description: `${dividend.type} - ${dividend.asset}`,
          amount: dividend.amount,
          date: new Date().toISOString(),
          type: 'INCOME',
          category: 'Rendimentos',
          accountId: accountId,
          isCleared: true
      };

      setState(prev => {
          // Atualiza saldo da conta
          const updatedAccounts = prev.accounts.map(acc => 
              acc.id === accountId ? { ...acc, balance: acc.balance + dividend.amount } : acc
          );

          return {
              ...prev,
              accounts: updatedAccounts,
              transactions: [newTxn, ...prev.transactions],
              processedCorporateActionIds: [...(prev.processedCorporateActionIds || []), dividend.id]
          };
      });
  };

  const handleResetReinvestment = () => {
      setState(prev => ({
          ...prev,
          lastReinvestmentResetDate: new Date().toISOString()
      }));
  }

  const handleDeleteTransaction = (id: string) => {
    setState(prev => {
        const txn = prev.transactions.find(t => t.id === id);
        if(!txn) return prev;

        // Reverter impacto financeiro
        const updatedAccounts = prev.accounts.map(acc => {
            if (acc.id !== txn.accountId) return acc;
            
            let newBalance = acc.balance;
            if (txn.type === 'INCOME') {
                newBalance -= txn.amount;
            } else if (txn.type === 'EXPENSE') {
                newBalance += txn.amount;
            } else if (txn.type === 'INVESTMENT') {
                if (txn.investmentType === 'SELL') newBalance -= txn.amount; // Venda somou, agora remove
                else newBalance += txn.amount; // Compra tirou, agora devolve
            }
            
            return { ...acc, balance: newBalance };
        });

        // Reverter Ativos (Simples - apenas quantidade)
        let updatedAssets = [...prev.assets];
        if (txn.type === 'INVESTMENT' && txn.assetTicker) {
            const assetIndex = updatedAssets.findIndex(a => a.ticker === txn.assetTicker);
            if (assetIndex >= 0) {
                const asset = updatedAssets[assetIndex];
                const qty = txn.assetQuantity || 0;
                // Se foi compra, remove quantidade. Se foi venda, adiciona quantidade.
                const isBuy = txn.investmentType === 'BUY' || !txn.investmentType;
                
                if (isBuy) {
                    asset.quantity -= qty;
                } else {
                    asset.quantity += qty;
                }
                
                // Se quantidade zerar, talvez remover o ativo? Por enquanto manter com 0.
                if (asset.quantity < 0) asset.quantity = 0;
                updatedAssets[assetIndex] = {...asset};
            }
        }

        return {
            ...prev,
            accounts: updatedAccounts,
            assets: updatedAssets,
            transactions: prev.transactions.filter(t => t.id !== id)
        };
    });
  }

  const handleNewTransactions = (newTxns: Transaction[]) => {
    setState(prev => {
      // 1. Atualizar Saldos de Contas
      const updatedAccounts = prev.accounts.map(acc => {
        const allTxns = [...newTxns, ...prev.transactions];
        const relevantTxns = allTxns.filter(t => t.accountId === acc.id);
        
        // Receita soma, Despesa subtrai, Investimento (Compra) subtrai, Investimento (Venda) soma
        const totalBalance = relevantTxns.reduce((sum, t) => {
          if (t.type === 'INCOME') return sum + t.amount;
          if (t.type === 'INVESTMENT') {
              return t.investmentType === 'SELL' ? sum + t.amount : sum - t.amount;
          }
          return sum - t.amount; 
        }, 0);
        return { ...acc, balance: totalBalance };
      });

      // 2. Atualizar Ativos (se houver investimento)
      let updatedAssets = [...prev.assets];
      newTxns.forEach(t => {
        if (t.type === 'INVESTMENT' && t.assetTicker) {
          const existing = updatedAssets.find(a => a.ticker === t.assetTicker);
          const isBuy = t.investmentType === 'BUY' || !t.investmentType; // Default buy
          const qty = t.assetQuantity || 0;

          if (existing) {
             let newQty = isBuy ? existing.quantity + qty : existing.quantity - qty;
             if (newQty < 0) newQty = 0; // Prevent negative stock

             if (newQty === 0) {
                 // ZEROU POSIÇÃO: Remove o ativo da lista para reiniciar o PM em futuras compras
                 updatedAssets = updatedAssets.filter(a => a.ticker !== t.assetTicker);
             } else {
                 // Preço médio ponderado só altera na compra
                 let newAvg = existing.averagePrice;
                 if (isBuy) {
                    const totalCost = (existing.quantity * existing.averagePrice) + t.amount;
                    newAvg = totalCost / newQty;
                 }
                 
                 updatedAssets = updatedAssets.map(a => a.id === existing.id ? {
                   ...a, quantity: newQty, averagePrice: Math.round(newAvg), currentPrice: t.assetPrice || a.currentPrice
                 } : a);
             }
          } else if (isBuy) {
             updatedAssets.push({
               id: `asset-${Date.now()}`,
               ticker: t.assetTicker!,
               quantity: qty,
               averagePrice: t.assetPrice || 0,
               currentPrice: t.assetPrice || 0,
               type: 'STOCK'
             });
          }
        }
      });

      return {
        ...prev,
        accounts: updatedAccounts,
        assets: updatedAssets,
        transactions: [...newTxns, ...prev.transactions]
      };
    });
  };

  const handleSaveCard = (card: CreditCard) => {
    setState(prev => {
      const exists = prev.creditCards.find(c => c.id === card.id);
      if (exists) {
        return { ...prev, creditCards: prev.creditCards.map(c => c.id === card.id ? card : c) };
      }
      return { ...prev, creditCards: [...prev.creditCards, card] };
    });
  };

  const handleDeleteCard = (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir este cartão?")) {
      setState(prev => ({ ...prev, creditCards: prev.creditCards.filter(c => c.id !== id) }));
    }
  };

  const handleSaveAccount = (account: Account) => {
    setState(prev => {
      const exists = prev.accounts.find(a => a.id === account.id);
      if (exists) {
        return { ...prev, accounts: prev.accounts.map(a => a.id === account.id ? account : a) };
      }
      return { ...prev, accounts: [...prev.accounts, account] };
    });
  };

  const handleDeleteAccount = (id: string) => {
    if (window.confirm("Tem certeza que deseja excluir esta conta?")) {
      setState(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== id) }));
    }
  };

  // --- VOICE HANDLERS ---
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Seu navegador não suporta comando de voz.");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        setIsListening(true);
    };

    recognition.onend = () => {
        setIsListening(false);
    };

    recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        console.log("Transcript:", transcript);
        
        // Process with AI
        const draft = await AIService.parseTransaction(transcript, state);
        if (draft) {
            setVoiceDraftData(draft);
            setModalOpen(true);
        } else {
            alert("Não entendi o comando. Tente novamente.");
        }
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopListening = () => {
    if (recognitionRef.current) {
        recognitionRef.current.stop();
    }
  };

  if (locked) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: 'white', flexDirection: 'column' }}>
        <Icons.Lock />
        <h3 style={{ marginTop: 20 }}>Acesso Seguro</h3>
        <button onClick={() => setLocked(false)} style={{ marginTop: 20, padding: '12px 32px', background: '#2979FF', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer' }}>Desbloquear App</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ paddingBottom: 100 }}>
        {activeTab === 'HOME' && <HomeScreen state={state} />}
        {activeTab === 'NOTIFICATIONS' && <NotificationsScreen state={state} />}
        {activeTab === 'CARDS' && <CardsScreen state={state} onDeleteTransaction={handleDeleteTransaction} />}
        {activeTab === 'BANKS' && <BankScreen state={state} onDeleteTransaction={handleDeleteTransaction} />}
        {activeTab === 'INVESTMENTS' && <InvestmentsScreen state={state} onConfirmDividend={handleConfirmDividend} onResetReinvestment={handleResetReinvestment} />}
        {activeTab === 'SETTINGS' && <SettingsScreen 
            state={state} 
            onSaveCard={handleSaveCard} 
            onDeleteCard={handleDeleteCard}
            onSaveAccount={handleSaveAccount}
            onDeleteAccount={handleDeleteAccount}
            onImportData={handleImportData}
        />}
      </div>

      <TransactionModal 
        isOpen={isModalOpen} 
        onClose={() => { setModalOpen(false); setVoiceDraftData(null); }} 
        state={state}
        initialData={voiceDraftData}
        onSave={handleNewTransactions}
      />

      <VoiceListeningOverlay isListening={isListening} />

      {/* Navegação Inferior integrada */}
      <nav 
        style={{ 
            position: 'fixed', bottom: 0, width: '100%', background: '#1e293b', borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '12px 0', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 40
        }}
      >
        <button onClick={() => setActiveTab('HOME')} style={{ background: 'none', border: 'none', color: activeTab === 'HOME' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Home /></button>
        <button onClick={() => setActiveTab('INVESTMENTS')} style={{ background: 'none', border: 'none', color: activeTab === 'INVESTMENTS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.TrendingUp /></button>
        <button onClick={() => setActiveTab('CARDS')} style={{ background: 'none', border: 'none', color: activeTab === 'CARDS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Card /></button>
        
        {/* Botão de Lançamento Integrado (Push-to-Talk) */}
        <button 
          onMouseDown={startListening}
          onMouseUp={stopListening}
          onTouchStart={(e) => { e.preventDefault(); startListening(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopListening(); }}
          onClick={(e) => {
              // Click rápido abre manual, se não for segurado
              if (!isListening) setModalOpen(true);
          }}
          style={{
            width: 52, height: 52, borderRadius: '50%', background: isListening ? '#FF5252' : '#2979FF',
            border: '4px solid #0f172a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(41, 121, 255, 0.4)', marginTop: -24, cursor: 'pointer',
            transition: 'all 0.2s', transform: isListening ? 'scale(1.2)' : 'scale(1)'
          }}>
          {isListening ? <Icons.Mic /> : <Icons.Plus />}
        </button>

        <button onClick={() => setActiveTab('BANKS')} style={{ background: 'none', border: 'none', color: activeTab === 'BANKS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Bank /></button>
        <button onClick={() => setActiveTab('NOTIFICATIONS')} style={{ background: 'none', border: 'none', color: activeTab === 'NOTIFICATIONS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}><Icons.Bell /></button>
        <button onClick={() => setActiveTab('SETTINGS')} style={{ background: 'none', border: 'none', color: activeTab === 'SETTINGS' ? '#2979FF' : '#64748b', padding: 8, cursor: 'pointer' }}>
          <Icons.Settings />
        </button>
      </nav>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);