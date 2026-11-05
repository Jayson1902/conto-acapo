import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Unsubscribe } from 'firebase/firestore';
import { Group, Expense, Settlement } from '../../models/conto-acapo.models';
import { FirebaseService } from '../../services/firebase.service';
import { DebtSimplifierService } from '../../services/debt-simplifier.service';

/** Riepilogo mostrato sulla card di ogni gruppo. */
interface GroupSummary {
  total: number;
  expenseCount: number;
  pendingPayments: number; // quanti pagamenti restano da fare (modalità semplificata)
  myBalance: number | null; // null se su questo dispositivo non ho scelto "chi sono"
  lastActivity: number; // timestamp dell'ultima attività
}

@Component({
  selector: 'app-group-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './group-list.html',
})
export class GroupList implements OnInit, OnDestroy {
  groups: Group[] = [];
  isLoading = true;

  // Gestione Modale Crea Gruppo
  isCreateModalOpen = false;
  isSubmitting = false;
  errorMessage = '';
  newGroupName = '';
  newGroupDescription = '';
  newMemberInput = '';
  newGroupMembers: string[] = [];

  // Entra con link o codice
  isJoinModalOpen = false;
  joinCodeInput = '';

  // Modale Modifica Info Gruppo
  isEditGroupModalOpen = false;
  editingGroupId = '';
  editGroupName = '';
  editGroupDescription = '';
  isSavingGroup = false;

  // Riepiloghi (totale speso, stato dei pagamenti) per ogni gruppo
  summaries: Record<string, GroupSummary> = {};
  openMenuGroupId: string | null = null;
  private summarySubs = new Map<string, { exp?: Unsubscribe; set?: Unsubscribe }>();
  private expensesByGroup = new Map<string, Expense[]>();
  private settlementsByGroup = new Map<string, Settlement[]>();

  private unsubGroups?: Unsubscribe;

  constructor(
    private firebaseService: FirebaseService,
    private debtService: DebtSimplifierService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadMyGroups();
  }

  loadMyGroups(): void {
    this.unsubGroups?.();
    this.unsubGroups = this.firebaseService.subscribeMyGroups((groups) => {
      this.groups = groups;
      this.isLoading = false;
      this.syncSummaries();
    });
  }

  ngOnDestroy(): void {
    this.unsubGroups?.();
    this.summarySubs.forEach((s) => {
      s.exp?.();
      s.set?.();
    });
    this.summarySubs.clear();
  }

  // --- CREA GRUPPO ---
  openCreateModal(): void {
    this.newGroupName = '';
    this.newGroupDescription = '';
    this.newMemberInput = '';
    this.newGroupMembers = [];
    this.errorMessage = '';
    this.isSubmitting = false;
    this.isCreateModalOpen = true;
  }

  closeCreateModal(): void {
    this.isCreateModalOpen = false;
    this.isSubmitting = false;
    this.errorMessage = '';
  }

  addMemberToNewGroup(): void {
    const name = this.newMemberInput.trim();
    if (!name) return;
    if (this.newGroupMembers.some((m) => m.toLowerCase() === name.toLowerCase())) {
      return;
    }
    this.newGroupMembers.push(name);
    this.newMemberInput = '';
  }

  removeMemberFromNewGroup(index: number): void {
    this.newGroupMembers.splice(index, 1);
  }

  async createGroup(): Promise<void> {
    // Se c'era del testo digitato nel campo del partecipante, aggiungilo automaticamente
    if (this.newMemberInput.trim()) {
      this.addMemberToNewGroup();
    }

    if (!this.newGroupName.trim()) {
      this.errorMessage = 'Inserisci un nome per il gruppo.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const created = await this.firebaseService.createGroup(
        this.newGroupName.trim(),
        this.newGroupMembers,
        this.newGroupDescription.trim() || undefined,
      );

      this.closeCreateModal();
      this.router.navigate(['/group', created.id]);
    } catch (err: any) {
      console.error('Errore creazione gruppo:', err);
      if (
        err?.message?.includes('PERMISSION_DENIED') ||
        err?.message?.includes('disabled') ||
        err?.code === 'permission-denied'
      ) {
        this.errorMessage =
          '⚠️ Il database Cloud Firestore non è ancora attivo sul tuo progetto Firebase. Vai su console.firebase.google.com > Build > Firestore Database e clicca su "Crea database" in modalità test.';
      } else {
        this.errorMessage = 'Errore durante la creazione: ' + (err?.message || 'Riprova.');
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  // --- ENTRA CON LINK O CODICE ---
  openJoinModal(): void {
    this.joinCodeInput = '';
    this.isJoinModalOpen = true;
  }

  closeJoinModal(): void {
    this.isJoinModalOpen = false;
  }

  joinGroup(): void {
    let code = this.joinCodeInput.trim();
    if (!code) return;

    if (code.includes('/group/')) {
      code = code.split('/group/')[1].split('/')[0].split('?')[0];
    }

    this.firebaseService.rememberGroupId(code);
    this.closeJoinModal();
    this.router.navigate(['/group', code]);
  }

  openGroup(groupId: string): void {
    this.router.navigate(['/group', groupId]);
  }

  openEditGroupModal(group: Group, event: Event): void {
    event.stopPropagation();
    this.editingGroupId = group.id;
    this.editGroupName = group.name;
    this.editGroupDescription = group.description || '';
    this.isEditGroupModalOpen = true;
  }

  closeEditGroupModal(): void {
    this.isEditGroupModalOpen = false;
    this.editingGroupId = '';
  }

  async saveGroupInfo(): Promise<void> {
    if (!this.editingGroupId || !this.editGroupName.trim()) return;
    this.isSavingGroup = true;
    try {
      await this.firebaseService.updateGroupInfo(
        this.editingGroupId,
        this.editGroupName,
        this.editGroupDescription,
      );
      this.closeEditGroupModal();
    } catch (err) {
      console.error('Errore modifica gruppo:', err);
      alert('Si è verificato un errore durante il salvataggio.');
    } finally {
      this.isSavingGroup = false;
    }
  }

  // --- MENU ⋯ DELLA CARD ---
  toggleMenu(groupId: string, event: Event): void {
    event.stopPropagation();
    this.openMenuGroupId = this.openMenuGroupId === groupId ? null : groupId;
  }

  @HostListener('document:click')
  closeMenu(): void {
    this.openMenuGroupId = null;
  }

  forgetGroup(groupId: string, event: Event): void {
    event.stopPropagation();
    this.openMenuGroupId = null;
    if (
      confirm(
        'Vuoi rimuovere questo gruppo dalla tua lista?\n\n' +
          'Il gruppo non viene eliminato: resta disponibile per gli altri membri ' +
          'e puoi rientrarci in qualsiasi momento con il suo link.',
      )
    ) {
      this.firebaseService.forgetGroupId(groupId);
      this.loadMyGroups();
    }
  }

  // --- RIEPILOGO DI OGNI GRUPPO (totale, stato pagamenti) ---
  /** Gruppi ordinati per ultima attività (spese o pagamenti), dal più recente. */
  get sortedGroups(): Group[] {
    const activity = (g: Group) => this.summaries[g.id]?.lastActivity ?? g.createdAt.getTime();
    return [...this.groups].sort((a, b) => activity(b) - activity(a));
  }

  private syncSummaries(): void {
    const ids = new Set(this.groups.map((g) => g.id));

    // Smetti di ascoltare i gruppi rimossi dalla lista
    for (const [id, subs] of this.summarySubs) {
      if (!ids.has(id)) {
        subs.exp?.();
        subs.set?.();
        this.summarySubs.delete(id);
        this.expensesByGroup.delete(id);
        this.settlementsByGroup.delete(id);
        const rest = { ...this.summaries };
        delete rest[id];
        this.summaries = rest;
      }
    }

    for (const g of this.groups) {
      if (!this.summarySubs.has(g.id)) {
        const subs: { exp?: Unsubscribe; set?: Unsubscribe } = {};
        this.summarySubs.set(g.id, subs);
        subs.exp = this.firebaseService.subscribeExpenses(g.id, (expenses) => {
          this.expensesByGroup.set(g.id, expenses);
          this.recomputeSummary(g.id);
        });
        subs.set = this.firebaseService.subscribeSettlements(g.id, (settlements) => {
          this.settlementsByGroup.set(g.id, settlements);
          this.recomputeSummary(g.id);
        });
      } else {
        this.recomputeSummary(g.id); // i membri potrebbero essere cambiati
      }
    }
  }

  private recomputeSummary(groupId: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    const expenses = this.expensesByGroup.get(groupId);
    const settlements = this.settlementsByGroup.get(groupId);
    if (!group || !expenses || !settlements) return; // aspetta entrambi i caricamenti

    const memberIds = group.members.map((m) => m.id);
    const balances = this.debtService.calculateBalances(expenses, memberIds, settlements);
    const debts = this.debtService.simplifyDebts(balances);

    const meId = this.readMyUserId(groupId, memberIds);
    const myBalance = meId ? (balances.find((b) => b.userId === meId)?.amount ?? 0) : null;

    const dates = [
      group.createdAt.getTime(),
      ...expenses.map((e) => e.date.getTime()),
      ...settlements.map((s) => s.date.getTime()),
    ];

    this.summaries = {
      ...this.summaries,
      [groupId]: {
        total: expenses.reduce((sum, e) => sum + e.amount, 0),
        expenseCount: expenses.length,
        pendingPayments: debts.length,
        myBalance,
        lastActivity: Math.max(...dates),
      },
    };
  }

  /** Legge "chi sono io" salvato dalla dashboard (stessa chiave usata in group-dashboard.ts). */
  private readMyUserId(groupId: string, memberIds: string[]): string | null {
    try {
      const saved = localStorage.getItem(`conto_acapo_me_${groupId}`);
      return saved && memberIds.includes(saved) ? saved : null;
    } catch {
      return null;
    }
  }

  formatEuro(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  }
}

