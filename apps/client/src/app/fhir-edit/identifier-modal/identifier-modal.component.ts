import {Component, Input, OnInit} from '@angular/core';
import {NgbActiveModal} from '@ng-bootstrap/ng-bootstrap';
import {Identifier} from '../../../../../../libs/tof-lib/src/lib/stu3/fhir';

@Component({
  selector: 'app-fhir-identifier-modal',
  templateUrl: './identifier-modal.component.html',
  styleUrls: ['./identifier-modal.component.css']
})
export class FhirIdentifierModalComponent implements OnInit {
  @Input() identifier: Identifier;

  constructor(
    public activeModal: NgbActiveModal) {

  }

  ngOnInit() {
  }
}
