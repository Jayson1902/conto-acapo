import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GroupDashboard } from './group-dashboard';

describe('GroupDashboard', () => {
  let component: GroupDashboard;
  let fixture: ComponentFixture<GroupDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupDashboard]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GroupDashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
