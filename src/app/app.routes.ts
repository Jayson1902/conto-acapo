import { Routes } from '@angular/router';
import { GroupList } from './components/group-list/group-list';
import { GroupDashboard } from './components/group-dashboard/group-dashboard';

export const routes: Routes = [
  { path: '', component: GroupList },
  { path: 'group/:id', component: GroupDashboard },
  { path: '**', redirectTo: '' },
];
