import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Unsubscribe } from 'firebase/firestore';
import {
  Group,
  Expense,
  Balance,
  Debt,
  User,
  ExpenseCategory,
  Settlement,
  SplitMode,
} from '../../models/conto-acapo.models';
import { DebtSimplifierService } from '../../services/debt-simplifier.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-group-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './group-dashboard.html',
  styleUrl: './group-dashboard.scss',
})
export class GroupDashboard implements OnInit, OnDestroy {
  group: Group | null = null;
  members: User[] = [];
  expenses: Expense[] = [];
  balances: Balance[] = [];
  settlements: Settlement[] = [];
  simplifiedDebts: Debt[] = [];
  directDebts: Debt[] = [];
  debtMode: 'direct' | 'simplified' = 'simplified';

  // Modale Nuova/Modifica Spesa
  isAddModalOpen = false;
  editingExpenseId: string | null = null;
  newExpenseDescription = '';
  newExpenseAmount: number | null = null;
  newExpensePaidBy = '';
  newExpenseSplitBetween: string[] = [];
  newExpenseCategory: ExpenseCategory = 'altro';
  newExpenseSplitMode: SplitMode = 'equal';
  newExpenseSplitValues: Record<string, number | null> = {};
  private draftId = '';

  splitModes: { id: SplitMode; label: string }[] = [
    { id: 'equal', label: 'Uguali' },
    { id: 'exact', label: 'Importi' },
    { id: 'percent', label: 'Percentuali' },
    { id: 'shares', label: 'Quote' },
  ];

  // Modale Aggiungi Amico
  isAddMemberModalOpen = false;
  newMemberName = '';

  // Stato condivisione link
  isCopied = false;

  // Modale Informativa Calcoli
  isInfoModalOpen = false;

  // Modale Modifica Info Gruppo
  isEditGroupModalOpen = false;
  editGroupName = '';
  editGroupDescription = '';
  isSavingGroup = false;

  // Gestione visibilità del pulsante Floating Action
  fabHidden = false;
  private lastScrollY = 0;

  // Selezione dell'utente corrente (memorizzata in locale)
  currentUserId: string | null = null;
  isGuest = false; // ha scelto "Sto solo guardando"
  isWhoAmIModalOpen = false;
  private whoAmIChecked = false;
  private readonly GUEST_VALUE = '__guest__';

  // Gestione modale di saldo debito
  isSettleModalOpen = false;
  settleFromUserId = '';
  settleToUserId = '';
  settleAmount: number | null = null;

  private unsubGroup?: Unsubscribe;
  private unsubExpenses?: Unsubscribe;
  private unsubSettlements?: Unsubscribe;

  categories: { id: ExpenseCategory; label: string; icon: string }[] = [
    { id: 'ristorante', label: 'Cene & Ristoranti', icon: '🍽️' },
    { id: 'serata', label: 'Aperitivi & Serate', icon: '🍻' },
    { id: 'spesa', label: 'Spesa & Market', icon: '🛒' },
    { id: 'viaggi', label: 'Benzina & Viaggi', icon: '🚗' },
    { id: 'alloggio', label: 'Alloggi & Airbnb', icon: '🏠' },
    { id: 'eventi', label: 'Eventi & Biglietti', icon: '🎟️' },
    { id: 'regali', label: 'Regali & Feste', icon: '🎁' },
    { id: 'altro', label: 'Altro / Varie', icon: '📦' },
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firebaseService: FirebaseService,
    private debtService: DebtSimplifierService,
  ) {}

  ngOnInit(): void {
    const groupId = this.route.snapshot.paramMap.get('id');
    if (!groupId) {
      this.router.navigate(['/']);
      return;
    }

    // Ascolto in tempo reale del gruppo
    this.unsubGroup = this.firebaseService.subscribeGroup(groupId, (group) => {
      if (!group) {
        this.router.navigate(['/']);
        return;
      }
      this.group = group;
      this.members = [...group.members];
      this.syncCurrentUser();
      this.recalculate();
    });

    // Ascolto in tempo reale delle spese del gruppo
    this.unsubExpenses = this.firebaseService.subscribeExpenses(groupId, (expenses) => {
      this.expenses = expenses;
      this.recalculate();
    });

    // Ascolto in tempo reale dei pagamenti già effettuati
    this.unsubSettlements = this.firebaseService.subscribeSettlements(groupId, (settlements) => {
      this.settlements = settlements;
      this.recalculate();
    });
  }

  ngOnDestroy(): void {
    this.unsubGroup?.();
    this.unsubExpenses?.();
    this.unsubSettlements?.();
  }

  // Nasconde il pulsante rapido durante lo scroll per migliorare l'usabilità mobile
  @HostListener('window:scroll')
  onWindowScroll(): void {
    const y = window.scrollY;
    const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
    this.fabHidden = y > this.lastScrollY && y > 120 && !nearBottom;
    this.lastScrollY = y;
  }

  recalculate(): void {
    if (!this.group) return;
    const memberIds = this.members.map((m) => m.id);
    this.balances = this.debtService.calculateBalances(this.expenses, memberIds, this.settlements);
    this.directDebts = this.debtService.calculateDirectDebts(
      this.expenses,
      memberIds,
      this.settlements,
    );
    this.simplifiedDebts = this.debtService.simplifyDebts(this.balances);
  }

  get displayedDebts(): Debt[] {
    return this.debtMode === 'direct' ? this.directDebts : this.simplifiedDebts;
  }

  setDebtMode(mode: 'direct' | 'simplified'): void {
    this.debtMode = mode;
  }

  getUserName(userId: string): string {
    return this.members.find((m) => m.id === userId)?.name || 'Sconosciuto';
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  async shareGroup(): Promise<void> {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `ContoAcapo - ${this.group?.name || 'Gruppo'}`,
          text: `Ecco le spese condivise del gruppo "${this.group?.name}" su ContoAcapo!`,
          url: url,
        });
        return;
      } catch {
        // Fallback su clipboard se l'utente annulla la condivisione
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      this.isCopied = true;
      setTimeout(() => (this.isCopied = false), 2500);
    } catch {
      alert(`Copia questo link e invialo ai tuoi amici:\n${url}`);
    }
  }

  // --- MODALE INFORMATIVA CALCOLI ---
  openInfoModal(): void {
    this.isInfoModalOpen = true;
  }

  closeInfoModal(): void {
    this.isInfoModalOpen = false;
  }

  // --- MODIFICA NOME E DESCRIZIONE GRUPPO ---
  openEditGroupModal(): void {
    if (!this.group) return;
    this.editGroupName = this.group.name;
    this.editGroupDescription = this.group.description || '';
    this.isEditGroupModalOpen = true;
  }

  closeEditGroupModal(): void {
    this.isEditGroupModalOpen = false;
  }

  async saveGroupInfo(): Promise<void> {
    if (!this.group || !this.editGroupName.trim()) return;
    this.isSavingGroup = true;
    try {
      await this.firebaseService.updateGroupInfo(
        this.group.id,
        this.editGroupName,
        this.editGroupDescription,
      );
      this.closeEditGroupModal();
    } catch (err) {
      console.error('Errore aggiornamento gruppo:', err);
      alert('Si è verificato un errore durante il salvataggio.');
    } finally {
      this.isSavingGroup = false;
    }
  }

  // --- GESTIONE PARTECIPANTI ---
  openAddMemberModal(): void {
    this.newMemberName = '';
    this.isAddMemberModalOpen = true;
  }

  closeAddMemberModal(): void {
    this.isAddMemberModalOpen = false;
  }

  async confirmAddMember(): Promise<void> {
    if (!this.group || !this.newMemberName.trim()) return;

    await this.firebaseService.addMemberToGroup(
      this.group.id,
      this.newMemberName.trim(),
      this.members,
    );
    this.closeAddMemberModal();
  }

  async removeMember(memberId: string): Promise<void> {
    if (!this.group) return;
    if (this.members.length <= 1) {
      alert('Il gruppo deve avere almeno un partecipante.');
      return;
    }

    // Se il membro ha pagato delle spese non può essere rimosso
    const paidCount = this.expenses.filter((e) => e.paidByUserId === memberId).length;
    if (paidCount > 0) {
      alert(
        `"${this.getUserName(memberId)}" ha pagato ${paidCount} spese. ` +
          `Eliminale o modificale prima di rimuoverlo.`,
      );
      return;
    }

    // Se il membro è coinvolto in dei pagamenti registrati non può essere rimosso
    const settledCount = this.settlements.filter(
      (s) => s.fromUserId === memberId || s.toUserId === memberId,
    ).length;
    if (settledCount > 0) {
      alert(
        `"${this.getUserName(memberId)}" è coinvolto in ${settledCount} pagamenti registrati. ` +
          `Eliminali prima di rimuoverlo.`,
      );
      return;
    }

    const memberName = this.getUserName(memberId);
    if (
      confirm(
        `Sei sicuro di voler rimuovere "${memberName}" dal gruppo? I saldi e le spese verranno ricalcolati tra i membri rimanenti.`,
      )
    ) {
      try {
        await this.firebaseService.removeMemberFromGroup(this.group.id, memberId, this.members);
      } catch (err) {
        console.error('Errore rimozione membro:', err);
        alert('Si è verificato un errore durante la rimozione.');
      }
    }
  }

  // --- GESTIONE SPESE ---
  openAddModal(): void {
    this.editingExpenseId = null;
    this.newExpenseDescription = '';
    this.newExpenseAmount = null;
    this.newExpensePaidBy = this.members[0]?.id || '';
    this.newExpenseSplitBetween = this.members.map((m) => m.id);
    this.newExpenseCategory = 'altro';
    this.newExpenseSplitMode = 'equal';
    this.newExpenseSplitValues = {};
    this.draftId = 'e_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    this.isAddModalOpen = true;
  }

  openEditModal(expense: Expense): void {
    this.editingExpenseId = expense.id;
    this.newExpenseDescription = expense.description;
    this.newExpenseAmount = expense.amount;
    this.newExpensePaidBy = expense.paidByUserId;
    this.newExpenseSplitBetween =
      expense.splitBetweenUserIds && expense.splitBetweenUserIds.length > 0
        ? [...expense.splitBetweenUserIds]
        : this.members.map((m) => m.id);
    this.newExpenseCategory = expense.category || 'altro';
    this.newExpenseSplitMode = expense.splitMode || 'equal';
    this.newExpenseSplitValues = { ...(expense.splitValues || {}) };
    this.isAddModalOpen = true;
  }

  closeAddModal(): void {
    this.isAddModalOpen = false;
    this.editingExpenseId = null;
  }

  toggleSplitMember(userId: string): void {
    if (this.newExpenseSplitBetween.includes(userId)) {
      this.newExpenseSplitBetween = this.newExpenseSplitBetween.filter((id) => id !== userId);
    } else {
      this.newExpenseSplitBetween = [...this.newExpenseSplitBetween, userId];
    }
    this.refreshSplitValues();
  }

  isMemberSelected(userId: string): boolean {
    return this.newExpenseSplitBetween.includes(userId);
  }

  toggleSelectAllSplit(): void {
    if (this.newExpenseSplitBetween.length === this.members.length) {
      this.newExpenseSplitBetween = [];
    } else {
      this.newExpenseSplitBetween = this.members.map((m) => m.id);
    }
    this.refreshSplitValues();
  }

  // --- DIVISIONE PERSONALIZZATA ---
  setSplitMode(mode: SplitMode): void {
    if (this.newExpenseSplitMode === mode) return;
    this.newExpenseSplitMode = mode;
    this.fillEqualValues();
  }

  /** Precompila i valori in parti uguali tra i partecipanti selezionati. */
  fillEqualValues(): void {
    const mode = this.newExpenseSplitMode;
    const ids = this.newExpenseSplitBetween;
    const values: Record<string, number | null> = {};

    if (mode === 'equal' || ids.length === 0) {
      this.newExpenseSplitValues = {};
      return;
    }

    if (mode === 'shares') {
      ids.forEach((id) => (values[id] = 1));
    } else {
      // exact: centesimi di euro; percent: centesimi di punto percentuale
      const total = mode === 'percent' ? 10000 : Math.round((this.newExpenseAmount || 0) * 100);
      const base = Math.floor(total / ids.length);
      const rest = total - base * ids.length;
      ids.forEach((id, i) => (values[id] = (base + (i < rest ? 1 : 0)) / 100));
    }
    this.newExpenseSplitValues = values;
  }

  /** Dopo aver cambiato i partecipanti, aggiorna i valori della modalità scelta. */
  private refreshSplitValues(): void {
    const mode = this.newExpenseSplitMode;
    if (mode === 'equal') return;
    if (mode === 'shares') {
      const values = { ...this.newExpenseSplitValues };
      this.newExpenseSplitBetween.forEach((id) => {
        if (values[id] === undefined || values[id] === null) values[id] = 1;
      });
      this.newExpenseSplitValues = values;
    } else {
      this.fillEqualValues();
    }
  }

  setSplitValue(userId: string, value: number | null): void {
    this.newExpenseSplitValues = {
      ...this.newExpenseSplitValues,
      [userId]: value === null || (value as unknown) === '' ? null : Number(value),
    };
  }

  get splitUnit(): string {
    return this.newExpenseSplitMode === 'exact'
      ? '€'
      : this.newExpenseSplitMode === 'percent'
        ? '%'
        : 'quote';
  }

  private cleanSplitValues(): Record<string, number> {
    const out: Record<string, number> = {};
    this.newExpenseSplitBetween.forEach((id) => {
      out[id] = Number(this.newExpenseSplitValues[id]) || 0;
    });
    return out;
  }

  /** Spesa "provvisoria" costruita dai campi del modulo, per anteprime e controlli. */
  private draftExpense(): Expense {
    const mode = this.newExpenseSplitMode;
    return {
      id: this.editingExpenseId || this.draftId,
      groupId: this.group?.id || '',
      description: '',
      amount: Number(this.newExpenseAmount) || 0,
      paidByUserId: this.newExpensePaidBy,
      splitBetweenUserIds: [...this.newExpenseSplitBetween],
      date: new Date(),
      splitMode: mode,
      splitValues: mode === 'equal' ? {} : this.cleanSplitValues(),
    };
  }

  /** Quota (in euro) che spetta a un partecipante, come verrà salvata. */
  previewShare(userId: string): number {
    const shares = this.debtService.computeShares(
      this.draftExpense(),
      this.members.map((m) => m.id),
    );
    return (shares.get(userId) || 0) / 100;
  }

  /** Messaggio di errore se i valori inseriti non sono validi, altrimenti null. */
  get splitError(): string | null {
    const mode = this.newExpenseSplitMode;
    if (mode === 'equal') return null;

    const vals = this.newExpenseSplitBetween.map(
      (id) => Number(this.newExpenseSplitValues[id]) || 0,
    );
    if (vals.length === 0) return null;
    if (vals.some((v) => v < 0)) return 'I valori non possono essere negativi.';
    if (vals.every((v) => v <= 0)) return 'Inserisci almeno un valore maggiore di zero.';

    const sumCents = Math.round(vals.reduce((s, v) => s + v, 0) * 100);

    if (mode === 'exact') {
      const totalCents = Math.round((this.newExpenseAmount || 0) * 100);
      if (totalCents > 0 && sumCents !== totalCents) {
        const diff = (totalCents - sumCents) / 100;
        return diff > 0
          ? `Mancano ${this.formatEuro(diff)} da assegnare.`
          : `Hai assegnato ${this.formatEuro(-diff)} in più.`;
      }
    }
    if (mode === 'percent' && sumCents !== 10000) {
      return `Le percentuali sommano ${(sumCents / 100).toLocaleString('it-IT')}%: devono fare 100%.`;
    }
    return null;
  }

  /** Frasi di riepilogo: "Dennis deve 19,10 € a Clark". */
  get expenseSummaryLines(): string[] {
    if (
      !this.newExpenseAmount ||
      this.newExpenseAmount <= 0 ||
      this.newExpenseSplitBetween.length === 0 ||
      this.splitError
    ) {
      return [];
    }
    const payerId = this.newExpensePaidBy;
    const payer = this.getUserName(payerId);
    const shares = this.debtService.computeShares(
      this.draftExpense(),
      this.members.map((m) => m.id),
    );
    const lines: string[] = [];
    shares.forEach((cents, id) => {
      if (id !== payerId && cents > 0) {
        lines.push(`${this.getUserName(id)} deve ${this.formatEuro(cents / 100)} a ${payer}`);
      }
    });
    if (lines.length === 0) {
      lines.push(`${payer} ha pagato solo per sé: nessun debito`);
    }
    return lines;
  }

  async saveExpense(): Promise<void> {
    if (!this.group) return;
    if (
      !this.newExpenseDescription.trim() ||
      !this.newExpenseAmount ||
      this.newExpenseAmount <= 0
    ) {
      return;
    }
    if (this.newExpenseSplitBetween.length === 0) {
      alert('Seleziona almeno un partecipante tra cui dividere la spesa.');
      return;
    }

    const expenseId = this.editingExpenseId || this.draftId;
    const existingExpense = this.editingExpenseId
      ? this.expenses.find((e) => e.id === this.editingExpenseId)
      : null;

    if (this.splitError) {
      alert(this.splitError);
      return;
    }
    const mode = this.newExpenseSplitMode;
    const values = mode === 'equal' ? {} : this.cleanSplitValues();
    // In modalità personalizzata partecipa solo chi ha un valore maggiore di zero
    const participants =
      mode === 'equal'
        ? [...this.newExpenseSplitBetween]
        : this.newExpenseSplitBetween.filter((id) => (values as Record<string, number>)[id] > 0);
    if (participants.length === 0) {
      alert('Seleziona almeno un partecipante tra cui dividere la spesa.');
      return;
    }
    const savedValues: Record<string, number> = {};
    participants.forEach((id) => {
      if (mode !== 'equal') savedValues[id] = (values as Record<string, number>)[id];
    });

    const expenseToSave: Expense = {
      id: expenseId,
      groupId: this.group.id,
      description: this.newExpenseDescription.trim(),
      amount: Number(this.newExpenseAmount),
      paidByUserId: this.newExpensePaidBy,
      splitBetweenUserIds: participants,
      date: existingExpense?.date || new Date(),
      category: this.newExpenseCategory,
      splitMode: mode,
      splitValues: savedValues,
    };

    this.closeAddModal();
    await this.firebaseService.saveExpense(expenseToSave);
  }

  /** Elimina la spesa aperta nel modale di modifica (l'eliminazione non è più sulla card). */
  async deleteEditingExpense(): Promise<void> {
    if (!this.editingExpenseId) return;
    const id = this.editingExpenseId;
    if (confirm('Vuoi eliminare questa spesa per tutti?')) {
      this.closeAddModal();
      await this.firebaseService.deleteExpense(this.group!.id, id);
    }
  }

  async deleteExpense(expenseId: string): Promise<void> {
    if (confirm('Vuoi eliminare questa spesa per tutti?')) {
      await this.firebaseService.deleteExpense(this.group!.id, expenseId);
    }
  }

  getSplitDescription(expense: Expense): string {
    // Ignora gli ID di membri che non esistono più nel gruppo
    const validIds = (expense.splitBetweenUserIds || []).filter((id) =>
      this.members.some((m) => m.id === id),
    );
    // Divisione personalizzata: mostra quanto spetta a ciascuno
    if (validIds.length > 0 && expense.splitMode && expense.splitMode !== 'equal') {
      const shares = this.debtService.computeShares(
        expense,
        this.members.map((m) => m.id),
      );
      const parts = validIds.map(
        (id) => `${this.getUserName(id)} ${this.formatEuro((shares.get(id) || 0) / 100)}`,
      );
      return `${parts.length} (${parts.join(', ')})`;
    }
    if (validIds.length === 0 || validIds.length === this.members.length) {
      return `Tutti (${this.members.length})`;
    }
    const names = validIds.map((id) => this.getUserName(id));
    return `${names.length} (${names.join(', ')})`;
  }

  getCategoryIcon(category?: string): string {
    const found = this.categories.find((c) => c.id === category);
    return found ? found.icon : '🏷️';
  }

  // --- PAGAMENTI (SALDARE UN DEBITO) ---
  openSettleModal(debt: Debt): void {
    this.settleFromUserId = debt.fromUserId;
    this.settleToUserId = debt.toUserId;
    this.settleAmount = debt.amount; // precompilato con l'importo intero, modificabile per pagamenti parziali
    this.isSettleModalOpen = true;
  }

  closeSettleModal(): void {
    this.isSettleModalOpen = false;
  }

  async confirmSettlement(): Promise<void> {
    if (!this.group || !this.settleAmount || this.settleAmount <= 0) return;

    const settlement: Settlement = {
      id: 's_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      groupId: this.group.id,
      fromUserId: this.settleFromUserId,
      toUserId: this.settleToUserId,
      amount: Math.round(Number(this.settleAmount) * 100) / 100,
      date: new Date(),
    };

    this.closeSettleModal();
    try {
      await this.firebaseService.saveSettlement(settlement);
    } catch (err) {
      console.error('Errore salvataggio pagamento:', err);
      alert('Non sono riuscito a registrare il pagamento. Riprova.');
    }
  }

  async deleteSettlement(settlement: Settlement): Promise<void> {
    const msg =
      `Annullare il pagamento di ${this.formatEuro(settlement.amount)} ` +
      `da ${this.getUserName(settlement.fromUserId)} a ${this.getUserName(settlement.toUserId)}? ` +
      `Il debito tornerà da saldare.`;
    if (confirm(msg)) {
      await this.firebaseService.deleteSettlement(settlement.groupId, settlement.id);
    }
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(date);
  }

  // --- CHI SONO IO (identità salvata solo su questo dispositivo) ---
  private get meStorageKey(): string {
    return `conto_acapo_me_${this.group?.id}`;
  }

  private readSavedUser(): string | null {
    try {
      return localStorage.getItem(this.meStorageKey);
    } catch {
      return null;
    }
  }

  private writeSavedUser(value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(this.meStorageKey);
      else localStorage.setItem(this.meStorageKey, value);
    } catch {
      // localStorage non disponibile: l'identità vale solo per questa sessione
    }
  }

  /** Chiamato a ogni aggiornamento del gruppo: all'inizio carica l'identità salvata,
   *  poi controlla che la persona scelta esista ancora tra i membri. */
  private syncCurrentUser(): void {
    if (!this.group) return;

    if (!this.whoAmIChecked) {
      this.whoAmIChecked = true;
      const saved = this.readSavedUser();
      if (saved === this.GUEST_VALUE) {
        this.isGuest = true;
      } else if (saved && this.members.some((m) => m.id === saved)) {
        this.currentUserId = saved;
      } else {
        this.isWhoAmIModalOpen = true; // prima visita (o membro rimosso): chiedi "Chi sei?"
      }
      return;
    }

    // Se la persona scelta è stata rimossa dal gruppo, richiedi l'identità
    if (this.currentUserId && !this.members.some((m) => m.id === this.currentUserId)) {
      this.currentUserId = null;
      this.writeSavedUser(null);
      this.isWhoAmIModalOpen = true;
    }
  }

  openWhoAmIModal(): void {
    this.isWhoAmIModalOpen = true;
  }

  selectMe(userId: string): void {
    this.currentUserId = userId;
    this.isGuest = false;
    this.writeSavedUser(userId);
    this.isWhoAmIModalOpen = false;
  }

  /** "Sto solo guardando" (se non ho ancora un'identità) oppure "Annulla" (se ce l'ho già). */
  closeWhoAmIModal(): void {
    if (!this.currentUserId) {
      this.isGuest = true;
      this.writeSavedUser(this.GUEST_VALUE);
    }
    this.isWhoAmIModalOpen = false;
  }

  get currentUser(): User | undefined {
    return this.members.find((m) => m.id === this.currentUserId);
  }

  get myBalance(): number {
    return this.balances.find((b) => b.userId === this.currentUserId)?.amount ?? 0;
  }

  /** Pagamenti che devo fare io (nella modalità di calcolo selezionata). */
  get myPayments(): Debt[] {
    return this.displayedDebts.filter((d) => d.fromUserId === this.currentUserId);
  }

  /** Pagamenti che devo ricevere io (nella modalità di calcolo selezionata). */
  get myCredits(): Debt[] {
    return this.displayedDebts.filter((d) => d.toUserId === this.currentUserId);
  }

  isMyDebt(debt: Debt): boolean {
    return (
      !!this.currentUserId &&
      (debt.fromUserId === this.currentUserId || debt.toUserId === this.currentUserId)
    );
  }

  /** Larghezza (0-100) della barretta del saldo, proporzionale al saldo più alto del gruppo. */
  balanceBarWidth(amount: number): number {
    const max = Math.max(0, ...this.balances.map((b) => Math.abs(b.amount)));
    if (max < 0.005) return 0;
    return Math.round((Math.abs(amount) / max) * 100);
  }

  get totalSpent(): number {
    return this.expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  // --- FORMATTAZIONE IMPORTI ---
  formatEuro(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  }

  formatSigned(n: number): string {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      signDisplay: 'exceptZero',
    }).format(n);
  }
}

