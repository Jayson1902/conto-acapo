export interface User {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  members: User[];
  createdAt: Date;
}

export type ExpenseCategory =
  | 'ristorante' // Cene, pizzerie, sushi, pranzi fuori
  | 'serata' // Bar, pub, aperitivi, drink, serate
  | 'spesa' // Supermercato, cibo in comune, grigliata
  | 'viaggi' // Benzina, pedaggi, treni, aerei, taxi
  | 'alloggio' // Airbnb, hotel, casa vacanze
  | 'eventi' // Biglietti cinema, concerti, festival, partite
  | 'regali' // Regali di compleanno o laurea di gruppo
  | 'altro'; // Varie

// Come viene divisa una spesa tra i partecipanti
export type SplitMode =
  | 'equal' // in parti uguali
  | 'exact' // importi esatti in euro per ciascuno
  | 'percent' // percentuali (devono sommare 100)
  | 'shares'; // quote / parti (es. 2 parti a me, 1 a lui)

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidByUserId: string; // ID dell'utente che ha anticipato i soldi
  splitBetweenUserIds: string[]; // ID degli utenti tra cui dividere la spesa
  date: Date;
  category?: ExpenseCategory;
  splitMode?: SplitMode; // se assente = 'equal' (compatibile con le spese già salvate)
  splitValues?: Record<string, number>; // userId -> euro | % | quote, secondo splitMode
}

export interface Balance {
  userId: string;
  amount: number; // Valore positivo = deve ricevere soldi, negativo = deve dare soldi
}

export interface Debt {
  fromUserId: string; // Chi deve pagare
  toUserId: string; // Chi deve ricevere
  amount: number; // Importo da saldare
}

// Pagamento effettivo di un debito: "fromUserId ha dato amount a toUserId"
export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string; // Chi ha pagato (il debitore)
  toUserId: string; // Chi ha ricevuto (il creditore)
  amount: number;
  date: Date;
}
