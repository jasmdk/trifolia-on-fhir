import {Component, OnInit} from '@angular/core';
import {StructureDefinitionService} from '../shared/structure-definition.service';
import {ConfigService} from '../shared/config.service';
import {Subject} from 'rxjs';
import {ChangeResourceIdModalComponent} from '../modals/change-resource-id-modal/change-resource-id-modal.component';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {ImplementationGuideService} from '../shared/implementation-guide.service';
import {Bundle, ImplementationGuide, StructureDefinition} from '../../../../../libs/tof-lib/src/lib/stu3/fhir';
import 'rxjs/add/operator/debounceTime';
import {FhirService} from '../shared/fhir.service';
import {Globals} from '../../../../../libs/tof-lib/src/lib/globals';
import {debounceTime} from 'rxjs/operators';
import {BaseComponent} from '../base.component';
import {AuthService} from '../shared/auth.service';
import {getErrorString} from '../../../../../libs/tof-lib/src/lib/helper';

@Component({
  templateUrl: './structure-definitions.component.html',
  styleUrls: ['./structure-definitions.component.css']
})
export class StructureDefinitionsComponent extends BaseComponent implements OnInit {
  public response: Bundle;
  public message: string;
  public page = 1;
  public nameText: string;
  public urlText: string;
  public titleText: string;
  public criteriaChangedEvent = new Subject();
  public implementationGuidesBundle: Bundle;
  public implementationGuideId: string = null;
  public showMoreSearch = false;
  public Globals = Globals;

  constructor(
    public configService: ConfigService,
    protected authService: AuthService,
    private fhirService: FhirService,
    private implementationGuideService: ImplementationGuideService,
    private structureDefinitionService: StructureDefinitionService,
    private modalService: NgbModal) {

    super(configService, authService);

    this.criteriaChangedEvent.pipe(debounceTime(500))
      .subscribe(() => {
        this.getStructureDefinitions();
      });
  }

  public get structureDefinitions(): StructureDefinition[] {
    if (!this.response || !this.response.entry) {
      return [];
    }

    return this.response.entry.map((entry) => {
      return <StructureDefinition>entry.resource;
    });
  }

  public get implementationGuides() {
    if (!this.implementationGuidesBundle || !this.implementationGuidesBundle.entry) {
      return [];
    }

    return this.implementationGuidesBundle.entry.map((entry) => <ImplementationGuide>entry.resource);
  }

  public remove(structureDefinition: StructureDefinition) {
    if (!confirm(`Are you sure you want to delete the structure definition ${structureDefinition.name}`)) {
      return;
    }

    this.structureDefinitionService.delete(structureDefinition.id)
      .subscribe(() => {
        this.message = `Successfully deleted structure definition ${structureDefinition.name} (${structureDefinition.id})`;
        const entry = (this.response.entry || []).find((entry) => entry.resource.id === structureDefinition.id);
        const index = this.response.entry.indexOf(entry);
        this.response.entry.splice(index, index >= 0 ? 1 : 0);
        setTimeout(() => this.message = '', 3000);
      }, (err) => {
        this.message = getErrorString(err);
      });
  }

  public changeId(structureDefinitionListItem: StructureDefinition) {
    const modalRef = this.modalService.open(ChangeResourceIdModalComponent);
    modalRef.componentInstance.resourceType = 'StructureDefinition';
    modalRef.componentInstance.originalId = structureDefinitionListItem.id;
    modalRef.result.then((newId) => {
      structureDefinitionListItem.id = newId;
    });
  }

  public nameTextChanged(value: string) {
    this.nameText = value;
    this.page = 1;
    this.criteriaChangedEvent.next();
  }

  public implementationGuideIdChanged(value: string) {
    this.implementationGuideId = value;
    this.page = 1;
    this.criteriaChangedEvent.next();
  }

  public urlTextChanged(value: string) {
    this.urlText = value;
    this.page = 1;
    this.criteriaChangedEvent.next();
  }

  public titleTextChanged(value: string) {
    this.titleText = value;
    this.page = 1;
    this.criteriaChangedEvent.next();
  }

  public toggleSearchOptions() {
    this.showMoreSearch = !this.showMoreSearch;

    if (!this.showMoreSearch && (this.titleText || this.urlText)) {
      this.nameText = null;
      this.urlText = null;
      this.criteriaChangedEvent.next();
    }
  }

  public clearFilters() {
    this.nameText = null;
    this.urlText = null;
    this.implementationGuideId = null;
    this.page = 1;
    this.criteriaChangedEvent.next();
  }

  public getStructureDefinitions() {
    this.response = null;
    this.configService.setStatusMessage('Loading structure definitions');

    this.structureDefinitionService.getStructureDefinitions(this.page, this.nameText, this.urlText, this.implementationGuideId)
      .subscribe((response: Bundle) => {
        this.response = response;
        this.configService.setStatusMessage('');
      }, (err) => {
        this.configService.handleError(err, 'Error loading structure definitions.');
      });
  }

  public getImplementationGuides() {
    this.implementationGuideService.getImplementationGuides()
      .subscribe((results) => {
        this.implementationGuidesBundle = results;
      }, (err) => {
        this.configService.handleError(err, 'Error loading implementation guides.');
      });
  }

  public getContactDisplay(structureDefinition: StructureDefinition) {
    if (structureDefinition.contact && structureDefinition.contact.length > 0) {
      const contact = structureDefinition.contact[0];

      if (contact.name && contact.telecom && contact.telecom.length > 0) {
        return `${contact.name} (${contact.telecom[0].value})`;
      } else if (contact.name) {
        return contact.name;
      } else {
        return contact.telecom[0].value;
      }
    }
  }

  private initData() {
    this.getStructureDefinitions();
    this.getImplementationGuides();
  }

  ngOnInit() {
    this.configService.fhirServerChanged.subscribe((fhirServer) => this.initData());
    this.initData();
  }
}
