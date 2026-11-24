import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateNfseContaContabilConfigDto, UpdateNfseContaContabilConfigDto } from './conta-contabil-config.dto';
import { ExportarLeituraFiscalDominioDto } from './exportar-leitura-fiscal-dominio.dto';

describe('codigo de produto do Layout Dominio', () => {
  it('aceita ponto nos codigos de produto da configuracao por servico e do padrao', () => {
    const config = plainToInstance(CreateNfseContaContabilConfigDto, {
      clienteId: 'd2719f42-4a29-45ae-a2c3-799fc92278b3',
      codigoServico: '170101',
      contaContabil: '670',
      produto: '14.04'
    });
    const exportacao = plainToInstance(ExportarLeituraFiscalDominioDto, {
      clienteId: 'd2719f42-4a29-45ae-a2c3-799fc92278b3',
      codigoEmpresa: '1',
      tipoRegistro: 'Entrada',
      produtoPadrao: '14.04'
    });

    expect(validateSync(config)).toHaveLength(0);
    expect(validateSync(exportacao)).toHaveLength(0);
  });

  it('rejeita separador de campos e caracteres de controle', () => {
    const config = plainToInstance(UpdateNfseContaContabilConfigDto, { produto: '14.04|X' });
    const exportacao = plainToInstance(ExportarLeituraFiscalDominioDto, {
      clienteId: 'd2719f42-4a29-45ae-a2c3-799fc92278b3',
      codigoEmpresa: '1',
      tipoRegistro: 'Entrada',
      produtoPadrao: '14.04\nX'
    });

    expect(validateSync(config).some((error) => error.property === 'produto')).toBe(true);
    expect(validateSync(exportacao).some((error) => error.property === 'produtoPadrao')).toBe(true);
  });
});
