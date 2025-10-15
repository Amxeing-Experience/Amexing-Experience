/*
* Add modal  organism tests
* Comprehensive tests for the new add modal
*/

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Add Modal Organism', () => {
  const componentPath = '/organisms/dashboard/modals/add-modal';

  test('should render without parameters', async () => {
    const html = await renderComponent(componentPath);
    expect(html).toBeTruthy();
    expect(html).toContain('modal');
    expect(html).toContain('modal fade');
    expect(html).toContain('modal-header');
    expect(html).toContain('modal-body');
    expect(html).toContain('modal-footer');
  });

  test('should render without addScripts parameter', async () => {
    const html = await renderComponent(componentPath, { data: { addScripts: false } });
    expect(html).toBeTruthy();
    expect(html).not.toContain("loadRolesSelect")
    expect(html).not.toContain("idsInputsModalAdd")
    expect(html).not.toContain("btnAddUserModalAdd")
    expect(html).not.toContain("showErrorMessageModalAdd")
    expect(html).not.toContain("validateInputsModalAdd")
    expect(html).not.toContain("AddUserModalAdd")
    expect(html).not.toContain("showAlert")
    expect(html).not.toContain("showSuccessAlert")
    expect(html).not.toContain("showErrorAlert")
    expect(html).not.toContain("showInfoAlert")
    expect(html).not.toContain("showValidationError")
  });

  test('should render with addScripts parameter', async () => {
    const html = await renderComponent(componentPath, { data: { addScripts: true } });
    expect(html).toBeTruthy();
    expect(html).toContain("loadRolesSelect")
    expect(html).toContain("idsInputsModalAdd")
    expect(html).toContain("btnAddUserModalAdd")
    expect(html).toContain("showErrorMessageModalAdd")
    expect(html).toContain("validateInputsModalAdd")
    expect(html).toContain("AddUserModalAdd")
    expect(html).toContain("showAlert")
    expect(html).toContain("showSuccessAlert")
    expect(html).toContain("showErrorAlert")
    expect(html).toContain("showInfoAlert")
    expect(html).toContain("showValidationError")
  });

  test('It must be rendered with the title, description, icon and modalId parameters', async () => {
    const parameters = {
      data: {
        title: 'Test title',
        modalId: 'test-modal',
        icon: 'test-icon',
        description: 'Test description',
      },
    };
    const html = await renderComponent(componentPath, parameters);
    expect(html).toBeTruthy();
    expect(html).toContain(`<span>${parameters.data.title}</span>`);
    expect(html).toContain(`id="${parameters.data.modalId}"`);
    expect(html).toContain(`ti ti-${parameters.data.icon}`);
    expect(html).toContain(`${parameters.data.description}</p>`);
  })

  test('It should be rendered with the parameters of text fields, password, selection, and text area.', async () => {
    const parameters = {
      data: {
        inputs: [
          {
            id: 'userName',
            name: 'username',
            label: 'Nombre',
            type: 'text',
            required: true,
            maxLength: 100,
            placeholder: 'test text',
          },
          {
            id: 'password',
            name: 'password',
            label: 'Contraseña',
            type: 'password',
            required: true,
            maxLength: 120,
            placeholder: '*****',
            helper: "test text password",
          },
          {
            id: 'userRole',
            name: 'roleId',
            label: 'Rol',
            type: 'select',
            required: true,
            helper: 'test select',
            multiple: '',
            options: [
              { dataName: 'test',
                value: 'TEST',
                label: "Test",
              }
            ]
          },
          {
            id: 'userRole',
            name: 'roleId',
            label: 'Rol',
            rows: 5,
            type: 'textarea',
            required: true,
            placeholder: 'test textarea',
          },
        ],
      },
    };
    const html = await renderComponent(componentPath, parameters);
    expect(html).toBeTruthy();
    // input text
    expect(html).toContain(`id="${parameters.data.inputs[0].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[0].name}"`);
    expect(html).toContain(`${parameters.data.inputs[0].label}`);
    expect(html).toContain(`type="${parameters.data.inputs[0].type}"`);
    expect(html).toContain(`required`);
    expect(html).toContain(`maxlength="${parameters.data.inputs[0].maxLength}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[0].placeholder}"`);
    // input password
    expect(html).toContain(`id="${parameters.data.inputs[1].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[1].name}"`);
    expect(html).toContain(`${parameters.data.inputs[1].label}`);
    expect(html).toContain(`type="${parameters.data.inputs[1].type}"`);
    expect(html).toContain(`maxlength="${parameters.data.inputs[1].maxLength}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[1].placeholder}"`);
    // input select
    expect(html).toContain(`id="${parameters.data.inputs[2].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[2].name}"`);
    expect(html).toContain(`${parameters.data.inputs[2].label}`);
    expect(html).toContain(`${parameters.data.inputs[2].helper}`);
    expect(html).toContain(`${parameters.data.inputs[2].options[0].dataName}`);
    expect(html).toContain(`${parameters.data.inputs[2].options[0].value}`);
    expect(html).toContain(`${parameters.data.inputs[2].options[0].label}`);
    // textarea
    expect(html).toContain(`id="${parameters.data.inputs[3].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[3].name}"`);
    expect(html).toContain(`${parameters.data.inputs[3].label}`);
    expect(html).toContain(`rows="${parameters.data.inputs[3].rows}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[3].placeholder}"`);
  })

  test('should render with button save', async () => {
    const parameters = {
      data: {
        addScripts: true,
        modalId: 'createUserModal',
        title: 'Agregar Usuario',
        icon: 'user-plus',
        description: 'Completa los datos para registrar un nuevo usuario.',
        dataAction: 'ADD_USER',
        primaryLabel: 'Agregar Usuario',
        actionURL: '/api/users/',
        rechargeData: true,
      }
    }
    const html = await renderComponent(componentPath, parameters);
    const $ = parseHTML(html);
    expect(html).toBeTruthy();
    expect($('.btn-primary')).toHaveLength(1);
    expect($('.btn-primary').text()).toContain(parameters.data.primaryLabel);
    expect($('.btn-primary').attr('data-action')).toBe(parameters.data.dataAction);
  })

  test('should render with all parameters', async () => {
    const parameters = {
      data: {
        addScripts: true,
        modalId: 'createUserModal',
        title: 'Agregar Usuario',
        icon: 'user-plus',
        description: 'Completa los datos para registrar un nuevo usuario.',
        dataAction: 'ADD_USER',
        primaryLabel: 'Agregar Usuario',
        actionURL: '/api/users/',
        rechargeData: true,
        inputs: [
          {
            id: 'userName',
            name: 'username',
            label: 'Nombre',
            type: 'text',
            required: true,
            maxLength: 100,
            placeholder: 'Ej. Juan',
          },
          {
            id: 'firstName',
            name: 'firstName',
            label: 'Apellido Paterno',
            type: 'text',
            required: true,
            maxLength: 100,
            placeholder: 'Ej. Pérez',
          },
          {
            id: 'lastName',
            name: 'lastName',
            label: 'Apellido Materno',
            type: 'text',
            required: true,
            maxLength: 100,
            placeholder: 'Ej. Pérez',
          },
          {
            id: 'userEmail',
            name: 'email',
            label: 'Correo electrónico',
            type: 'email',
            required: true,
            maxLength: 120,
            placeholder: 'Ej. user@example.com',
          },
          {
            id: 'password',
            name: 'password',
            label: 'Contraseña',
            type: 'password',
            required: true,
            maxLength: 120,
            placeholder: '*****',
            helper: "La contraseña debe tener al menos 12 caracteres, una mayúscula, un número y un símbolo.",
          },
          {
            id: 'organizationId',
            name: 'organizationId',
            label: 'Organización',
            type: 'text',
            value: 'amexing',
            required: true,
            maxLength: 120,
            placeholder: '',
            hidden: true,
          },
          {
            id: 'userRole',
            name: 'roleId',
            label: 'Rol',
            type: 'select',
            required: true,
            helper: 'Ej. admin, superadmin o employee_amexing',
            multiple: '',
            options: [
              { dataName: '',
                value: '',
                label: "Ninguno",
              }
            ]
          },
          {
            id: 'userRole',
            name: 'roleId',
            label: 'Rol',
            rows: 5,
            type: 'textarea',
            required: true,
            placeholder: 'test textarea',
          },
        ],
        headerStyle: 'background: linear-gradient(135deg, #5e72e4 0%, #825ee4 100%);'
      }
    }
    const html = await renderComponent(componentPath, parameters);

    expect(html).toBeTruthy();
    expect(html).toContain("loadRolesSelect")
    expect(html).toContain("idsInputsModalAdd")
    expect(html).toContain(`<span>${parameters.data.title}</span>`);
    expect(html).toContain(`id="${parameters.data.modalId}"`);
    expect(html).toContain(`ti ti-${parameters.data.icon}`);
    expect(html).toContain(`${parameters.data.description}</p>`);
    expect(html).toContain(`data-action="${parameters.data.dataAction}"`);
    expect(html).toContain(`${parameters.data.primaryLabel}`);
    expect(html).toContain(`${parameters.data.actionURL}`);
    expect(html).toContain(`const rechargeData = ${parameters.data.rechargeData}`);
    // input text
    expect(html).toContain(`id="${parameters.data.inputs[0].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[0].name}"`);
    expect(html).toContain(`${parameters.data.inputs[0].label}`);
    expect(html).toContain(`type="${parameters.data.inputs[0].type}"`);
    expect(html).toContain(`required`);
    expect(html).toContain(`maxlength="${parameters.data.inputs[0].maxLength}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[0].placeholder}"`);
    // input password
    expect(html).toContain(`id="${parameters.data.inputs[4].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[4].name}"`);
    expect(html).toContain(`${parameters.data.inputs[4].label}`);
    expect(html).toContain(`type="${parameters.data.inputs[4].type}"`);
    expect(html).toContain(`required`);
    expect(html).toContain(`maxlength="${parameters.data.inputs[4].maxLength}"`);
    expect(html).toContain(`${parameters.data.inputs[4].placeholder}`);
    expect(html).toContain(`${parameters.data.inputs[4].helper}`);
    // input hidden
    expect(html).toContain(`id="${parameters.data.inputs[5].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[5].name}"`);
    expect(html).toContain(`${parameters.data.inputs[5].label}`);
    expect(html).toContain(`type="${parameters.data.inputs[5].type}"`);
    expect(html).toContain(`value="${parameters.data.inputs[5].value}"`);
    expect(html).toContain(`required`);
    expect(html).toContain(`maxlength="${parameters.data.inputs[5].maxLength}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[5].placeholder}"`);
    expect(html).toContain(`hidden`);
    // input select
    expect(html).toContain(`id="${parameters.data.inputs[6].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[6].name}"`);
    expect(html).toContain(`${parameters.data.inputs[6].label}`);
    expect(html).toContain(`${parameters.data.inputs[6].helper}`);
    expect(html).toContain(`${parameters.data.inputs[6].options[0].dataName}`);
    expect(html).toContain(`${parameters.data.inputs[6].options[0].value}`);
    expect(html).toContain(`${parameters.data.inputs[6].options[0].label}`);
    // textarea
    expect(html).toContain(`id="${parameters.data.inputs[7].id}"`);
    expect(html).toContain(`name="${parameters.data.inputs[7].name}"`);
    expect(html).toContain(`${parameters.data.inputs[7].label}`);
    expect(html).toContain(`rows="${parameters.data.inputs[7].rows}"`);
    expect(html).toContain(`placeholder="${parameters.data.inputs[7].placeholder}"`);

    expect(html).toContain(`${parameters.data.headerStyle}`);
  })

});

