import {Component, Input, OnInit} from '@angular/core';
import {Practitioner} from '../../models/stu3/fhir';
import {Globals} from '../../globals';

@Component({
    selector: 'app-fhir-practitioner',
    templateUrl: './practitioner.component.html',
    styleUrls: ['./practitioner.component.css']
})
export class FhirPractitionerComponent implements OnInit {
    @Input() practitioner = new Practitioner();

    public Globals = Globals;

    constructor() {
    }

    ngOnInit() {
    }
}
